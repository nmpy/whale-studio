// src/lib/uzupro/sync.ts
// for ウズプロ: UZU Pro CMS → Whale Studio の予約/プレイヤー同期サービス（正本 = CMS）。
//
// 保証（spec §5/§6）:
//   - 予約(UzuProBooking) 1 件に複数プレイヤー(UzuProPlayer)。人数は可変（固定値で閉じない）。
//   - 冪等: 予約は [oaId, workId, externalBookingId]、プレイヤーは [bookingId, playerIndex] の複合 unique upsert。
//     同一 payload を複数回受信しても重複作成しない。
//   - 巻き戻り防止: 受信 sourceUpdatedAt が保存済みより古ければ更新しない（applied=false）。
//   - 個人情報は保持しない（氏名/メール/電話/住所/備考は入力段階で拒否・保存しない）。
//   - 公演/回は LiveSession(origin=UZU_PRO) を再利用（#591 の upsertExternalLiveSession）。
//   - 人数変更に対応（payload に無い既存プレイヤーは cancelled 化。行は消さず LIFF/監査を保持）。
//   - 部分失敗を追跡（プレイヤー単位で reason 付き結果を返す）。

import { Prisma, type UzuProBookingStatus, type UzuProPlayerStatus } from "@prisma/client";
import { upsertExternalLiveSession } from "@/lib/live-external-session";

export interface SyncPlayerInput {
  playerIndex: number;
  externalPlayerId?: string | null;
  externalTicketId?: string | null;
  status?: UzuProPlayerStatus; // 既定 active
}

export interface SyncBookingInput {
  oaId: string;
  workId: string;
  externalSessionRef: string;
  sessionStartsAt: Date | null;
  sessionEndsAt: Date | null;
  externalBookingId: string;
  participantCount: number;
  bookingStatus: UzuProBookingStatus;
  sourceUpdatedAt: Date;
  players: SyncPlayerInput[];
  now: Date;
}

export interface SyncPlayerResult {
  playerIndex: number;
  outcome: "created" | "updated" | "cancelled" | "failed";
  reason?: string; // 個人情報を含めない
}

export interface SyncBookingResult {
  applied: boolean; // false = stale sourceUpdatedAt（巻き戻り防止でスキップ）
  bookingCreated: boolean;
  bookingId: string;
  liveSessionId: string;
  players: SyncPlayerResult[];
  playersCreated: number;
  playersUpdated: number;
  playersCancelled: number;
  playersFailed: number;
}

/**
 * 1 予約分を冪等同期する。**呼び出し側で prisma.$transaction を張ること**（予約+プレイヤーを原子的に反映）。
 */
export async function syncUzuProBooking(
  tx: Prisma.TransactionClient,
  input: SyncBookingInput,
): Promise<SyncBookingResult> {
  // 1. 公演/回（LiveSession, origin=UZU_PRO）を冪等 upsert（#591 のサービスを再利用）。
  const session = await upsertExternalLiveSession(tx, {
    oaId: input.oaId,
    workId: input.workId,
    externalSessionRef: input.externalSessionRef,
    startsAt: input.sessionStartsAt,
    endsAt: input.sessionEndsAt,
  });

  // 2. 既存予約を取得（巻き戻り判定用）。
  const existing = await tx.uzuProBooking.findUnique({
    where: {
      oaId_workId_externalBookingId: {
        oaId: input.oaId,
        workId: input.workId,
        externalBookingId: input.externalBookingId,
      },
    },
    select: { id: true, sourceUpdatedAt: true },
  });

  // 3. 巻き戻り防止: 受信が保存済みより古ければ何も更新しない。
  if (existing && input.sourceUpdatedAt < existing.sourceUpdatedAt) {
    return {
      applied: false,
      bookingCreated: false,
      bookingId: existing.id,
      liveSessionId: session.id,
      players: [],
      playersCreated: 0,
      playersUpdated: 0,
      playersCancelled: 0,
      playersFailed: 0,
    };
  }

  // 4. 予約を upsert（新規 create / 既存 update）。
  const booking = await tx.uzuProBooking.upsert({
    where: {
      oaId_workId_externalBookingId: {
        oaId: input.oaId,
        workId: input.workId,
        externalBookingId: input.externalBookingId,
      },
    },
    create: {
      oaId: input.oaId,
      workId: input.workId,
      liveSessionId: session.id,
      externalBookingId: input.externalBookingId,
      participantCount: input.participantCount,
      status: input.bookingStatus,
      sourceUpdatedAt: input.sourceUpdatedAt,
      syncedAt: input.now,
    },
    update: {
      liveSessionId: session.id,
      participantCount: input.participantCount,
      status: input.bookingStatus,
      sourceUpdatedAt: input.sourceUpdatedAt,
      syncedAt: input.now,
    },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  const bookingCreated = booking.createdAt.getTime() === booking.updatedAt.getTime();

  // 5. プレイヤーを 1 件ずつ upsert（部分失敗を追跡）。予約キャンセル時は全員 cancelled。
  const results: SyncPlayerResult[] = [];
  let playersCreated = 0;
  let playersUpdated = 0;
  let playersCancelled = 0;
  let playersFailed = 0;

  const bookingCancelled = input.bookingStatus === "cancelled";
  const incomingIndexes = new Set<number>();

  for (const p of input.players) {
    incomingIndexes.add(p.playerIndex);
    const desiredStatus: UzuProPlayerStatus = bookingCancelled ? "cancelled" : p.status ?? "active";
    try {
      const before = await tx.uzuProPlayer.findUnique({
        where: {
          bookingId_playerIndex: { bookingId: booking.id, playerIndex: p.playerIndex },
        },
        select: { id: true },
      });
      await tx.uzuProPlayer.upsert({
        where: {
          bookingId_playerIndex: { bookingId: booking.id, playerIndex: p.playerIndex },
        },
        create: {
          oaId: input.oaId,
          bookingId: booking.id,
          externalPlayerId: p.externalPlayerId ?? null,
          externalTicketId: p.externalTicketId ?? null,
          playerIndex: p.playerIndex,
          status: desiredStatus,
        },
        update: {
          externalPlayerId: p.externalPlayerId ?? null,
          externalTicketId: p.externalTicketId ?? null,
          status: desiredStatus,
          // lineUserId / linkedAt は同期で触らない（PR2 の LINE 連携が正本）。
        },
      });
      if (before) {
        playersUpdated += 1;
        results.push({ playerIndex: p.playerIndex, outcome: desiredStatus === "cancelled" ? "cancelled" : "updated" });
      } else {
        playersCreated += 1;
        results.push({ playerIndex: p.playerIndex, outcome: "created" });
      }
    } catch (err) {
      playersFailed += 1;
      // P2002 = externalTicketId の per-OA 一意衝突など。理由は種別のみ（PII 非出力）。
      const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "UNKNOWN";
      results.push({ playerIndex: p.playerIndex, outcome: "failed", reason: `db_error:${code}` });
    }
  }

  // 6. 人数減 / キャンセル反映: payload に無い既存プレイヤーを cancelled 化（行は消さない）。
  const stragglers = await tx.uzuProPlayer.findMany({
    where: {
      bookingId: booking.id,
      status: { not: "cancelled" },
      ...(incomingIndexes.size > 0 ? { playerIndex: { notIn: Array.from(incomingIndexes) } } : {}),
    },
    select: { id: true, playerIndex: true },
  });
  for (const s of stragglers) {
    await tx.uzuProPlayer.update({ where: { id: s.id }, data: { status: "cancelled" } });
    playersCancelled += 1;
    results.push({ playerIndex: s.playerIndex, outcome: "cancelled" });
  }

  return {
    applied: true,
    bookingCreated,
    bookingId: booking.id,
    liveSessionId: session.id,
    players: results,
    playersCreated,
    playersUpdated,
    playersCancelled,
    playersFailed,
  };
}
