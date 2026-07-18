// src/lib/live-ticket-link.ts
// Live Mode「チケットリンクトークン」の生成 / ハッシュ / 状態判定 / URL 生成 / 有効期限算出 /
// LiveTeam 遅延解決 / チケットID マスク（Phase 1）。
//
// 設計思想（既存 live-actor-invite.ts / studio-invite.ts / MemberLineLinkToken と共通）:
//   - 平文トークンは DB に保存しない（tokenHash=sha256 hex のみ）。平文は URL に一度だけ載せ、ログ/commit へ出さない。
//   - トークンは 256bit（randomBytes(32)）・base64url（URL-safe・43 char）。
//   - team 単位で複数メンバーが使うため one-time consume は行わない（consumeMemberLinkCode は再利用しない）。
//     実際の LINE ↔ チケットの紐付けは LiveParticipant を正とする（Phase 2）。

import { randomBytes, createHash } from "node:crypto";
import { matchKeysEqual } from "@/lib/live-match-key";

/** URL に載せる平文トークン（256bit / base64url / 43 char）。 */
export function generateTicketToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 平文トークン → DB 検索用ハッシュ（sha256 hex / 64 char）。平文は保存しない。 */
export function hashTicketToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type TicketTokenState = "none" | "active" | "expired" | "revoked";

/** トークン状態（失効 > 期限切れ > 有効）。Phase 1 では expired/revoked は常に拒否。 */
export function ticketTokenState(
  token: { expiresAt: Date | null; revokedAt: Date | null } | null,
  now: Date = new Date(),
): TicketTokenState {
  if (!token) return "none";
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 公演日時が取れる場合の既定 = 公演日時 + 3 日。 */
export const TICKET_TOKEN_DAYS_AFTER_SHOW = 3;
/** 公演日時が取れない場合の既定 = 発行 + 30 日。 */
export const TICKET_TOKEN_DEFAULT_DAYS = 30;
/** 外部から指定できる有効期限の許容上限（日）。極端に長い期限を防ぐ。 */
export const TICKET_TOKEN_MAX_DAYS = 60;

/**
 * 有効期限を算出する。優先順位:
 *   1. requestedDays 指定あり → now + clamp(requestedDays, 1, MAX)（外部指定・上限あり）
 *   2. 公演日時 startsAt あり → startsAt + 3 日（実際の公演日時を優先）
 *   3. いずれも無し         → now + 30 日
 */
export function resolveTicketExpiresAt(args: {
  startsAt?: Date | null;
  requestedDays?: number | null;
  now?: Date;
}): Date {
  const now = args.now ?? new Date();
  if (args.requestedDays != null && Number.isFinite(args.requestedDays)) {
    const days = Math.min(Math.max(1, Math.floor(args.requestedDays)), TICKET_TOKEN_MAX_DAYS);
    return new Date(now.getTime() + days * DAY_MS);
  }
  if (args.startsAt) return new Date(args.startsAt.getTime() + TICKET_TOKEN_DAYS_AFTER_SHOW * DAY_MS);
  return new Date(now.getTime() + TICKET_TOKEN_DEFAULT_DAYS * DAY_MS);
}

/** 専用 LIFF URL を生成（生 ticketId は載せない・トークンのみ）。 */
export function buildTicketLiffUrl(liffId: string, token: string): string {
  return `https://liff.line.me/${liffId}/ticket?t=${token}`;
}

/**
 * チケットID の表示用マスク（先頭 3〜4 + 末尾 2・中間 *）。
 * 極端に短い ID は元の値を過剰に露出しない安全なフォールバック。
 */
export function maskTicketId(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "****";
  if (s.length <= 4) return "*".repeat(Math.max(2, s.length));
  const head = s.length >= 8 ? 4 : 3;
  const tail = 2;
  const maskLen = Math.max(2, s.length - head - tail);
  return s.slice(0, head) + "*".repeat(maskLen) + s.slice(s.length - tail);
}

export interface TeamMatchInput {
  id: string;
  reservationNumber: string | null;
  ticketId: string | null;
}

export type TeamMatchResult =
  | { kind: "ok"; team: TeamMatchInput }
  | { kind: "not_found" }
  | { kind: "ambiguous" } // 複数 team が一致し一意に決められない
  | { kind: "conflict" }; // reservationNumber と ticketId が別々の team に一致

/**
 * 遅延解決: 候補 teams から reservationNumber（主）→ ticketId（フォールバック）で一致 team を選ぶ純関数。
 *   - 一致が複数 → ambiguous（勝手に先頭採用しない）
 *   - reservationNumber と ticketId が別 team に一意一致 → conflict（勝手に一方採用しない）
 *   - 既存自己申告フロー（linkReservationToLiveTeam）と同じ matchKeysEqual・同じ照合順序。
 */
export function pickMatchingTeam(
  teams: TeamMatchInput[],
  keys: { reservationNumber: string | null; ticketId: string | null },
): TeamMatchResult {
  const byRes = keys.reservationNumber ? teams.filter((t) => matchKeysEqual(t.reservationNumber, keys.reservationNumber)) : [];
  const byTicket = keys.ticketId ? teams.filter((t) => matchKeysEqual(t.ticketId, keys.ticketId)) : [];

  if (keys.reservationNumber && keys.ticketId) {
    const resOne = byRes.length === 1 ? byRes[0] : null;
    const ticketOne = byTicket.length === 1 ? byTicket[0] : null;
    if (resOne && ticketOne && resOne.id !== ticketOne.id) return { kind: "conflict" };
  }
  if (byRes.length === 1) return { kind: "ok", team: byRes[0] };
  if (byRes.length > 1) return { kind: "ambiguous" };
  if (byTicket.length === 1) return { kind: "ok", team: byTicket[0] };
  if (byTicket.length > 1) return { kind: "ambiguous" };
  return { kind: "not_found" };
}
