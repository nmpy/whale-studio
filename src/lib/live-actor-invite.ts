// src/lib/live-actor-invite.ts
// Phase 2-J: 演者招待 URL の token 生成 / hash / 状態判定ヘルパー。
//
// セキュリティ方針:
//   - 平文 token は DB に保存しない (= tokenHash のみ保存)
//   - hash は sha256 hex (= 64 char)。`bcrypt` を使うほどでもなく、token 自体が
//     高エントロピー (256 bit) のため固定 hash で十分。
//   - 平文 token は URL に含まれるため、ログ / commit / chat には絶対に貼らない。

import { randomBytes, createHash } from "node:crypto";

/** URL に乗せる平文 token (= 32 byte → 43 char URL-safe base64) */
export function generateInviteToken(): string {
  // randomBytes(32) → 256 bit エントロピー。base64url で 43 char。
  return randomBytes(32).toString("base64url");
}

/** token を DB 検索用の hash に変換 (sha256 hex / 64 char) */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 初期有効期限 (= 7 日) を返す */
export function defaultInviteExpiresAt(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  return d;
}

export type InviteState =
  | "none"      // 招待発行されていない / 該当 row なし
  | "active"    // 有効 (= 期限内・未使用・未失効)
  | "used"      // 使用済み
  | "expired"   // 期限切れ
  | "revoked";  // 無効化済み

export function inviteState(invite: {
  expiresAt: Date | null;
  usedAt: Date | null;
  revokedAt: Date | null;
} | null, now: Date = new Date()): InviteState {
  if (!invite) return "none";
  if (invite.revokedAt) return "revoked";
  if (invite.usedAt) return "used";
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}
