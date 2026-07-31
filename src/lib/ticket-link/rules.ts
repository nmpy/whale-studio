// src/lib/ticket-link/rules.ts
//
// チケット連携のドメインルール（状態遷移 / コードネーム検証 / 参加人数の解決）。
// DOM・Prisma 非依存の純関数のみ。サーバ側の再検証にもクライアント側の入力補助にも同じ関数を使う。

import type { TicketLinkStatus, TicketLinkDraftStatus } from "@prisma/client";

/** 一時ドラフト（OCR 原文・購入者名等の PII を含む）の保持時間。確定 or 期限で本文を破棄する。 */
export const TICKET_LINK_DRAFT_TTL_HOURS = 24;

/** AI 抽出の再試行上限（無限リトライ防止）。 */
export const TICKET_LINK_EXTRACT_MAX_ATTEMPTS = 3;

/** コードネームの最大文字数。 */
export const CODE_NAME_MAX_LENGTH = 20;

// ─── 状態遷移 ────────────────────────────────────────────────────────────────

/** ドラフトの許可された遷移。ここに無い遷移は不正として弾く。 */
const DRAFT_TRANSITIONS: Record<TicketLinkDraftStatus, readonly TicketLinkDraftStatus[]> = {
  RECEIVED:     ["EXTRACTING", "NEEDS_REVIEW", "FAILED", "EXPIRED"],
  EXTRACTING:   ["NEEDS_REVIEW", "FAILED", "EXPIRED"],
  NEEDS_REVIEW: ["CONFIRMED", "EXTRACTING", "EXPIRED"],
  // 終端。確定・失敗・期限切れからは戻さない（再開は新しいドラフトを作る）。
  CONFIRMED:    [],
  FAILED:       ["EXPIRED"],
  EXPIRED:      [],
};

export function canTransitionDraft(from: TicketLinkDraftStatus, to: TicketLinkDraftStatus): boolean {
  return DRAFT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 連携本体の許可された遷移。
 * CONFLICT は運営確認を経てのみ解消する（自動で LINKED へ戻さない）。
 */
const LINK_TRANSITIONS: Record<TicketLinkStatus, readonly TicketLinkStatus[]> = {
  PENDING_UZU_BOOKING: ["LINKED", "CONFLICT", "REVOKED"],
  LINKED:              ["CONFLICT", "REVOKED"],
  CONFLICT:            ["LINKED", "REVOKED"],
  REVOKED:             [],
};

export function canTransitionLink(from: TicketLinkStatus, to: TicketLinkStatus): boolean {
  return LINK_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 差分同期の対象か（未同期 or 同期後に更新された）。 */
export function needsUzuSync(link: { uzuSyncedAt: Date | null; updatedAt: Date }): boolean {
  if (!link.uzuSyncedAt) return true;
  return link.updatedAt.getTime() > link.uzuSyncedAt.getTime();
}

// ─── 参加人数 ────────────────────────────────────────────────────────────────

/** チケット種別の設定（作品設定 or 取込データ由来）。 */
export interface TicketTypeOption {
  /** 表示名。 */
  label: string;
  /** 1 枚あたりの参加人数。設定されていなければ null。 */
  participantCount: number | null;
}

/**
 * チケット種別から参加人数を解決する。
 *
 * **名称の数字からは推測しない**（`2名グループチケット` を文字列解析しない）。
 * 設定に人数が無い場合は null を返し、呼び出し側が確認を求める。
 */
export function resolveParticipantCount(
  ticketType: string | null | undefined,
  options: readonly TicketTypeOption[],
): number | null {
  if (!ticketType) return null;
  const key = ticketType.normalize("NFKC").trim().toLowerCase();
  const hit = options.find((o) => o.label.normalize("NFKC").trim().toLowerCase() === key);
  if (!hit) return null;
  if (hit.participantCount == null || hit.participantCount < 1) return null;
  return hit.participantCount;
}

// ─── コードネーム ────────────────────────────────────────────────────────────

export type CodeNameIssue =
  | { index: number; code: "EMPTY";       message: string }
  | { index: number; code: "TOO_LONG";    message: string }
  | { index: number; code: "CONTROL_CHAR"; message: string }
  | { index: number; code: "DUPLICATE";   message: string };

export interface CodeNameValidation {
  ok: boolean;
  /** trim 済みの値（保存にはこちらを使う）。 */
  normalized: string[];
  /** 登録を止めるエラー。 */
  errors: CodeNameIssue[];
  /** 登録は可能だが確認を促す警告（同一予約内の重複）。 */
  warnings: CodeNameIssue[];
}

// 制御文字（改行・タブ含む）は許可しない。
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * コードネーム一覧を検証する。人数分の入力欄すべてが対象。
 * サーバ側でも同じ関数で再検証する（クライアント検証だけに依存しない）。
 */
export function validateCodeNames(raw: readonly (string | null | undefined)[]): CodeNameValidation {
  const normalized = raw.map((v) => (v ?? "").normalize("NFKC").trim());
  const errors: CodeNameIssue[] = [];
  const warnings: CodeNameIssue[] = [];

  normalized.forEach((value, index) => {
    if (value.length === 0) {
      errors.push({ index, code: "EMPTY", message: "コードネームを入力してください。" });
      return;
    }
    if (CONTROL_CHARS.test(value)) {
      errors.push({ index, code: "CONTROL_CHAR", message: "使用できない文字が含まれています。" });
      return;
    }
    if (value.length > CODE_NAME_MAX_LENGTH) {
      errors.push({
        index,
        code: "TOO_LONG",
        message: `コードネームは${CODE_NAME_MAX_LENGTH}文字以内で入力してください。`,
      });
    }
  });

  // 同一予約内の重複は「警告」（同名を許容する運用もあるため登録は止めない）。
  const seen = new Map<string, number>();
  normalized.forEach((value, index) => {
    if (value.length === 0) return;
    const key = value.toLowerCase();
    if (seen.has(key)) {
      warnings.push({ index, code: "DUPLICATE", message: "同じコードネームが複数あります。" });
    } else {
      seen.set(key, index);
    }
  });

  return { ok: errors.length === 0, normalized, errors, warnings };
}
