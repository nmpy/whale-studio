// src/lib/member-invite.ts
// メールアドレス不要の「招待URL」(MemberInvite) の token 生成 / hash / 状態判定ヘルパー。
//
// セキュリティ方針 (= business-invite / live-actor-invite と同一):
//   - 平文 token は DB に保存しない (= tokenHash のみ保存)
//   - hash は sha256 hex (= 64 char)。token 自体が高エントロピー (256 bit) のため固定 hash で十分。
//   - 平文 token は URL に含まれるため、ログ / commit / chat には絶対に貼らない。
//   - role は URL に出さず DB 解決する (= 改ざん防止)。

import { randomBytes, createHash } from "node:crypto";

/** URL に乗せる平文 token (= 32 byte → 43 char URL-safe base64)。 */
export function generateMemberInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** token を DB 検索用の hash に変換 (sha256 hex / 64 char)。 */
export function hashMemberInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 発行時の既定有効期限 (= 7 日。既存メール招待と揃える)。 */
export const MEMBER_INVITE_DEFAULT_EXPIRES_IN_DAYS = 7;

/** 同一 OA に同時に持てる「有効な(=未受諾・未失効・未期限切れ)」招待URLの上限 (mass 発行防止)。 */
export const MEMBER_INVITE_ACTIVE_LIMIT = 30;

/** expiresInDays から expiresAt を算出。null / 0 以下は無期限 (= null)。 */
export function resolveMemberInviteExpiresAt(now: Date, expiresInDays: number | null | undefined): Date | null {
  if (expiresInDays == null || expiresInDays <= 0) return null;
  return new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
}

export type MemberInviteStatus = "pending" | "accepted" | "expired" | "revoked";

/** 招待レコードの状態を判定する (優先順: revoked > accepted > expired > pending)。 */
export function memberInviteStatus(
  invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): MemberInviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedAt) return "accepted";
  if (invite.expiresAt && now > invite.expiresAt) return "expired";
  return "pending";
}

/** 平文 token から参加用 URL を組み立てる (発行直後の表示専用)。 */
export function buildMemberInviteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://app.whale-studio.app").replace(/\/$/, "");
  return `${base}/invites/member/${token}`;
}
