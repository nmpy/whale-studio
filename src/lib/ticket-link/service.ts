// src/lib/ticket-link/service.ts
//
// 手動登録フローのサーバー側ロジック（ドラフト状態機械・最終確定・競合処理）。
//
// 重要な不変条件:
//   - 最終確定操作が来るまで TicketLink を作らない（ドラフトは本登録ではない）。
//   - ステップは UI ではなくサーバーの draft.step で強制する（飛ばし進行を防ぐ）。
//   - 参加人数は「確定時点の作品設定」から ticketTypeKey で解決し、確定時にスナップショットする。
//   - 手動入力の購入者名はドラフト内のみ。確定成功時・やり直し時に即座に消す。
//   - 競合は (OA, 作品, 予約番号, 試行した LINE userId) で 1 行に収束させ、再試行で増殖させない。

import { Prisma } from "@prisma/client";
import type { TicketLinkDraftStep, PrismaClient } from "@prisma/client";
import { normalizeReservationNumber } from "@/lib/ticket-link/reservation-number";
import { validateCodeNames, TICKET_LINK_DRAFT_TTL_HOURS } from "@/lib/ticket-link/rules";
import { resolveTicketTypeByKey } from "@/lib/ticket-link/settings";
import type { TicketLinkSettings } from "@/types";

type Db = PrismaClient | Prisma.TransactionClient;

/** ドラフトに保存する手動入力の内容。購入者名はここにしか置かない。 */
export interface ManualDraftPayload {
  ticketTypeKey: string;
  /** 確認画面表示用。確定時に破棄する（TicketLink/Member/外部APIへは出さない）。 */
  purchaserName: string | null;
  normalizedReservationNumber: string;
  reservationNumberRaw: string;
  codeNames?: string[];
}

// ─── ステップ機械 ────────────────────────────────────────────────────────────

const STEP_ORDER: TicketLinkDraftStep[] = ["MANUAL_INPUT", "TICKET_REVIEW", "CODE_NAMES", "FINAL_REVIEW"];

/** 前進は 1 段ずつ、後退は許可された前段階のみ。 */
export function canAdvanceStep(from: TicketLinkDraftStep | null, to: TicketLinkDraftStep): boolean {
  if (from === null) return to === "MANUAL_INPUT" || to === "TICKET_REVIEW";
  const i = STEP_ORDER.indexOf(from);
  const j = STEP_ORDER.indexOf(to);
  if (i < 0 || j < 0) return false;
  // 1 段進む or 任意の前段階へ戻る
  return j === i + 1 || j < i;
}

/** そのステップから最終確定してよいか。 */
export function canConfirmFromStep(step: TicketLinkDraftStep | null): boolean {
  return step === "FINAL_REVIEW";
}

export function draftExpiresAt(now: Date): Date {
  return new Date(now.getTime() + TICKET_LINK_DRAFT_TTL_HOURS * 60 * 60 * 1000);
}

export function isDraftExpired(draft: { expiresAt: Date; status: string }, now: Date): boolean {
  return draft.status === "EXPIRED" || draft.expiresAt.getTime() <= now.getTime();
}

// ─── 結果型 ──────────────────────────────────────────────────────────────────

export type ConfirmOutcome =
  /** 新規に本登録が成立した。 */
  | { kind: "created";  ticketLinkId: string; status: "PENDING_UZU_BOOKING" }
  /** 同じユーザーの同じ予約。既存を返す（二重作成しない）。 */
  | { kind: "existing"; ticketLinkId: string; status: string }
  /** 別ユーザーが同じ予約番号を先に登録済み。詳細は一切返さない。 */
  | { kind: "conflict" }
  /** 入力・状態が不正。 */
  | { kind: "invalid"; code: ConfirmInvalidCode; message: string };

export type ConfirmInvalidCode =
  | "DRAFT_NOT_FOUND"
  | "DRAFT_EXPIRED"
  | "INVALID_STEP"
  | "INVALID_TICKET_TYPE"
  | "INVALID_RESERVATION_NUMBER"
  | "CODE_NAME_COUNT_MISMATCH"
  | "CODE_NAME_INVALID";

export interface ConfirmInput {
  draftId:    string;
  /** 認証で確定した値のみを渡すこと（クライアント値は使わない）。 */
  lineUserId: string;
  displayName: string | null;
  oaId:       string;
  workId:     string;
  settings:   TicketLinkSettings;
  now:        Date;
}

/**
 * 最終確定。単一トランザクション内で呼ぶこと。
 * 再送されても同一 TicketLink を返し、TicketLinkMember を二重作成しない。
 */
export async function confirmTicketLink(tx: Db, input: ConfirmInput): Promise<ConfirmOutcome> {
  const { draftId, lineUserId, oaId, workId, settings, now } = input;

  // 2) ドラフト再取得（所有者・OA・Work をクエリ条件に含めて他人のドラフトを引けなくする）
  const draft = await tx.ticketLinkDraft.findFirst({
    where: { id: draftId, lineUserId, oaId, workId },
    select: { id: true, status: true, step: true, expiresAt: true, confirmedPayload: true },
  });
  if (!draft) {
    return { kind: "invalid", code: "DRAFT_NOT_FOUND", message: "入力内容が見つかりませんでした。最初からやり直してください。" };
  }

  // 3) 期限・状態の検証
  if (isDraftExpired(draft, now)) {
    return { kind: "invalid", code: "DRAFT_EXPIRED", message: "入力内容の保持期限が切れました。最初からやり直してください。" };
  }
  if (draft.status === "CONFIRMED") {
    // 再送: 既に確定済み。作成済みの TicketLink を返す（二重確定しない）。
    const payload = (draft.confirmedPayload ?? {}) as Record<string, unknown>;
    const existingId = typeof payload.ticketLinkId === "string" ? payload.ticketLinkId : null;
    if (existingId) {
      const link = await tx.ticketLink.findUnique({ where: { id: existingId }, select: { id: true, status: true } });
      if (link) return { kind: "existing", ticketLinkId: link.id, status: link.status };
    }
    return { kind: "invalid", code: "INVALID_STEP", message: "この内容はすでに登録されています。" };
  }
  if (!canConfirmFromStep(draft.step)) {
    return { kind: "invalid", code: "INVALID_STEP", message: "手順が正しくありません。最初からやり直してください。" };
  }

  const payload = (draft.confirmedPayload ?? {}) as Partial<ManualDraftPayload>;

  // 4) チケット種別を **現在の設定** から安定キーで解決（無効化済みは解決しない）
  const ticketType = resolveTicketTypeByKey(settings, payload.ticketTypeKey);
  if (!ticketType) {
    return { kind: "invalid", code: "INVALID_TICKET_TYPE", message: "選択されたチケット種別は現在ご利用いただけません。" };
  }

  // 予約番号はサーバー側で再正規化・再検証する
  const normalized = normalizeReservationNumber(payload.normalizedReservationNumber ?? payload.reservationNumberRaw);
  if (!normalized) {
    return { kind: "invalid", code: "INVALID_RESERVATION_NUMBER", message: "予約番号の形式が正しくありません。" };
  }

  // 5) コードネームをサーバー側で再検証。件数は参加人数と完全一致であること。
  const codeNames = Array.isArray(payload.codeNames) ? payload.codeNames : [];
  if (codeNames.length !== ticketType.participantCount) {
    return { kind: "invalid", code: "CODE_NAME_COUNT_MISMATCH", message: "コードネームの数が正しくありません。" };
  }
  const validation = validateCodeNames(codeNames);
  if (!validation.ok) {
    return { kind: "invalid", code: "CODE_NAME_INVALID", message: validation.errors[0]?.message ?? "コードネームが正しくありません。" };
  }

  // 6) 同じ予約番号の有効な既存連携を確認
  const active = await tx.ticketLink.findFirst({
    where: {
      oaId, workId,
      normalizedReservationNumber: normalized,
      status: { in: ["PENDING_UZU_BOOKING", "LINKED"] },
    },
    select: { id: true, status: true, lineUserId: true },
  });

  if (active) {
    if (active.lineUserId === lineUserId) {
      // 同一ユーザーの再登録 → 既存を返し、コードネームを勝手に上書きしない。
      await markDraftConfirmed(tx, draft.id, active.id, now);
      return { kind: "existing", ticketLinkId: active.id, status: active.status };
    }
    // 別ユーザー → 自動上書きせず競合として扱う。
    await upsertConflict(tx, { oaId, workId, normalized, lineUserId, displayName: input.displayName, ticketType, source: "LIFF_MANUAL", now });
    await purgeDraftPersonalData(tx, draft.id, now);
    return { kind: "conflict" };
  }

  // 7)(8) 本登録 + 人数分のコードネーム
  try {
    const created = await tx.ticketLink.create({
      data: {
        oaId, workId,
        lineUserId,
        lineDisplayName: input.displayName,
        normalizedReservationNumber: normalized,
        reservationNumberRaw: payload.reservationNumberRaw ?? null,
        ticketTypeKey:   ticketType.ticketTypeKey,
        ticketType:      ticketType.ticketTypeLabel,
        participantCount: ticketType.participantCount,
        source: "LIFF_MANUAL",
        status: "PENDING_UZU_BOOKING",
        confirmedAt: now,
        members: {
          create: validation.normalized.map((codeName, i) => ({ memberIndex: i + 1, codeName })),
        },
      },
      select: { id: true },
    });

    // 9)(10) ドラフトを確定済みにし、購入者名など一時情報を消す
    await markDraftConfirmed(tx, draft.id, created.id, now);
    return { kind: "created", ticketLinkId: created.id, status: "PENDING_UZU_BOOKING" };
  } catch (e) {
    // 競合送信: 部分 UNIQUE 違反。500 にせず既存/競合へ変換する。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await tx.ticketLink.findFirst({
        where: {
          oaId, workId,
          normalizedReservationNumber: normalized,
          status: { in: ["PENDING_UZU_BOOKING", "LINKED"] },
        },
        select: { id: true, status: true, lineUserId: true },
      });
      if (raced && raced.lineUserId === lineUserId) {
        await markDraftConfirmed(tx, draft.id, raced.id, now);
        return { kind: "existing", ticketLinkId: raced.id, status: raced.status };
      }
      await upsertConflict(tx, { oaId, workId, normalized, lineUserId, displayName: input.displayName, ticketType, source: "LIFF_MANUAL", now });
      await purgeDraftPersonalData(tx, draft.id, now);
      return { kind: "conflict" };
    }
    throw e;
  }
}

/** ドラフトを CONFIRMED にし、購入者名など一時情報を消す（PR4 のバッチを待たない）。 */
async function markDraftConfirmed(tx: Db, draftId: string, ticketLinkId: string, now: Date): Promise<void> {
  await tx.ticketLinkDraft.update({
    where: { id: draftId },
    data: {
      status: "CONFIRMED",
      // 参照用に ticketLinkId のみ残し、購入者名・入力内容は破棄する。
      confirmedPayload: { ticketLinkId } as Prisma.InputJsonValue,
      ocrRawText: null,
      extractedPayload: Prisma.DbNull,
      updatedAt: now,
    },
  });
}

/** やり直し・競合時に一時情報（購入者名等）を消す。 */
export async function purgeDraftPersonalData(tx: Db, draftId: string, now: Date): Promise<void> {
  await tx.ticketLinkDraft.update({
    where: { id: draftId },
    data: { confirmedPayload: Prisma.DbNull, ocrRawText: null, extractedPayload: Prisma.DbNull, updatedAt: now },
  });
}

interface ConflictInput {
  oaId: string;
  workId: string;
  normalized: string;
  lineUserId: string;
  displayName: string | null;
  ticketType: { ticketTypeKey: string; ticketTypeLabel: string; participantCount: number };
  source: "LIFF_MANUAL";
  now: Date;
}

/**
 * 競合レコードを (OA, 作品, 予約番号, 試行ユーザー) で 1 行に収束させる。
 * 同一ユーザーの再試行では既存の競合行を返し、増殖させない。
 */
async function upsertConflict(tx: Db, c: ConflictInput): Promise<void> {
  const existing = await tx.ticketLink.findFirst({
    where: {
      oaId: c.oaId, workId: c.workId,
      normalizedReservationNumber: c.normalized,
      lineUserId: c.lineUserId,
      status: "CONFLICT",
    },
    select: { id: true },
  });
  if (existing) {
    await tx.ticketLink.update({ where: { id: existing.id }, data: { updatedAt: c.now } });
    return;
  }
  try {
    await tx.ticketLink.create({
      data: {
        oaId: c.oaId, workId: c.workId,
        lineUserId: c.lineUserId,
        lineDisplayName: c.displayName,
        normalizedReservationNumber: c.normalized,
        ticketTypeKey: c.ticketType.ticketTypeKey,
        ticketType: c.ticketType.ticketTypeLabel,
        participantCount: c.ticketType.participantCount,
        source: c.source,
        status: "CONFLICT",
        confirmedAt: c.now,
      },
    });
  } catch (e) {
    // 同時実行で先に作られた場合は何もしない（増殖させない）。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}
