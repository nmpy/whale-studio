// src/lib/uzu-outbox.ts
//
// UZU Pro CMS 連携の transactional outbox（Step 1）。
//
// 設計:
//   - **enqueue は業務データ更新と同一 transaction**。呼び出し側が渡した tx クライアントで作成する。
//     「Whale では連携済みだが UZU へ送るイベントが存在しない」状態を作らない。
//   - HTTP 送信は transaction の外で cron worker（/api/cron/uzu-outbox）が行う。
//   - eventId は行の id をそのまま使う。**再送しても同じ eventId** を送るため、
//     UZU 側の IntegrationInboundEvent @@unique([source, eventId]) が二重適用を防ぐ。
//   - 再送は指数バックオフ。恒久失敗（4xx）と一時障害（5xx/timeout/network/429）を分離する。
//
// idempotencyKey:
//   同一の業務イベントだけを重複排除する。将来の正当な再リンク（別の LINE ユーザー、
//   別チームへの付け替え）を潰さないよう lineUserId まで含める。
//     player_line.linked:{participantId}:{teamId}:{lineUserId}

import type { Prisma, PrismaClient } from "@prisma/client";

/** transaction クライアントでも通常クライアントでも受け取れる最小形。 */
export type OutboxDb = Prisma.TransactionClient | PrismaClient;

export const UZU_EVENT_TYPES = {
  playerLineLinked: "player_line.linked",
  /** Step 1 では UZU 側の受信契約のみ維持。Whale からの送信は保留。 */
  playerRegistrationUpdated: "player_registration.updated",
} as const;
export type UzuEventType = (typeof UZU_EVENT_TYPES)[keyof typeof UZU_EVENT_TYPES];

/** 送信ステータス。 */
export const OUTBOX_STATUS = {
  pending: "pending",
  sending: "sending",
  sent: "sent",
  failed: "failed",
} as const;

/** 再送間隔（分）。attempt 回数 → 待ち時間。最後の要素を超えたら恒久失敗にする。 */
export const BACKOFF_MINUTES: readonly number[] = [1, 5, 30, 120, 720];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/** sending のまま滞留したとみなす閾値（ms）。worker が pending へ戻す。 */
export const STUCK_SENDING_MS = 10 * 60 * 1000;

/** attempt 回目の失敗に対する次回試行時刻。上限超過なら null（＝恒久失敗）。 */
export function nextAttemptAtFor(attempt: number, now: Date): Date | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[attempt] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
  return new Date(now.getTime() + minutes * 60_000);
}

/** player_line.linked の冪等キー。再リンク（別 LINE ユーザー / 別チーム）は別キーになる。 */
export function playerLineLinkedKey(args: { participantId: string; teamId: string; lineUserId: string }): string {
  return `${UZU_EVENT_TYPES.playerLineLinked}:${args.participantId}:${args.teamId}:${args.lineUserId}`;
}

export type PlayerLineLinkedPayload = {
  reservationNumber: string;
  lineUserId: string;
  lineDisplayName: string | null;
  oaId: string;
  workId: string;
  matchedVia: "reservation" | "ticket";
};

/**
 * 送信キューへ積む（**呼び出し側の transaction 内で実行すること**）。
 *
 * 同一 idempotencyKey が既にあれば何もしない（重複作成しない）。
 * ここで例外を握りつぶさない。enqueue に失敗したら呼び出し側の transaction ごと巻き戻す。
 */
export async function enqueueUzuEvent(
  db: OutboxDb,
  args: {
    oaId: string;
    workId: string;
    uzuProjectId: string;
    eventType: UzuEventType;
    idempotencyKey: string;
    payload: PlayerLineLinkedPayload | Record<string, unknown>;
    now: Date;
  },
): Promise<{ enqueued: boolean }> {
  const existing = await db.uzuOutboxEvent.findUnique({
    where:  { idempotencyKey: args.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { enqueued: false };

  await db.uzuOutboxEvent.create({
    data: {
      oaId:           args.oaId,
      workId:         args.workId,
      uzuProjectId:   args.uzuProjectId,
      eventType:      args.eventType,
      payloadJson:    args.payload as Prisma.InputJsonValue,
      idempotencyKey: args.idempotencyKey,
      status:         OUTBOX_STATUS.pending,
      nextAttemptAt:  args.now,
    },
  });
  return { enqueued: true };
}

/** worker が処理する行の最小形。 */
export type ClaimableRow = {
  id: string;
  oaId: string;
  workId: string;
  uzuProjectId: string;
  eventType: string;
  payloadJson: unknown;
  attempt: number;
};

/**
 * sending のまま滞留した行を pending へ戻す（プロセス落ち等からの回復）。
 * @returns 回復した件数
 */
export async function recoverStuckSending(db: PrismaClient, now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - STUCK_SENDING_MS);
  const r = await db.uzuOutboxEvent.updateMany({
    where: { status: OUTBOX_STATUS.sending, claimedAt: { lt: threshold } },
    data:  { status: OUTBOX_STATUS.pending },
  });
  return r.count;
}

/**
 * 送信対象を claim（pending → sending）。
 * updateMany の件数で排他を確認し、同じ行を複数 worker が掴まないようにする。
 */
export async function claimPending(db: PrismaClient, now: Date, limit: number): Promise<ClaimableRow[]> {
  const candidates = await db.uzuOutboxEvent.findMany({
    where:   { status: OUTBOX_STATUS.pending, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take:    limit,
    select:  { id: true, oaId: true, workId: true, uzuProjectId: true, eventType: true, payloadJson: true, attempt: true },
  });

  const claimed: ClaimableRow[] = [];
  for (const row of candidates) {
    const r = await db.uzuOutboxEvent.updateMany({
      where: { id: row.id, status: OUTBOX_STATUS.pending },
      data:  { status: OUTBOX_STATUS.sending, claimedAt: now },
    });
    if (r.count === 1) claimed.push(row as ClaimableRow);
  }
  return claimed;
}

/** 送信成功として確定。 */
export async function markSent(db: PrismaClient, id: string, now: Date): Promise<void> {
  await db.uzuOutboxEvent.update({
    where: { id },
    data:  { status: OUTBOX_STATUS.sent, sentAt: now, lastErrorCode: null, lastError: null },
  });
}

/**
 * 送信失敗を記録。
 *   retryable=true  → バックオフして pending へ戻す（上限到達なら failed）
 *   retryable=false → 即 failed（400 invalid payload / 401 / 403 等）
 */
export async function markFailure(
  db: PrismaClient,
  row: { id: string; attempt: number },
  input: { retryable: boolean; errorCode: string; message: string; now: Date },
): Promise<{ status: "pending" | "failed" }> {
  const attempt = row.attempt + 1;
  const next = input.retryable ? nextAttemptAtFor(attempt, input.now) : null;
  const status = next ? OUTBOX_STATUS.pending : OUTBOX_STATUS.failed;
  await db.uzuOutboxEvent.update({
    where: { id: row.id },
    data: {
      status,
      attempt,
      ...(next ? { nextAttemptAt: next } : {}),
      claimedAt:     null,
      lastErrorCode: input.errorCode,
      lastError:     input.message.slice(0, 500),
    },
  });
  return { status: status === OUTBOX_STATUS.pending ? "pending" : "failed" };
}
