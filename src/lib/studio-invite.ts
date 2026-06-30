// src/lib/studio-invite.ts
// スタジオ管理から発行する「招待URL」(StudioInvite) の token 生成 / hash / 有効期限 / 状態判定ヘルパー。
//
// セキュリティ方針 (= member-invite / business-invite と同一):
//   - 平文 token は DB に保存しない (= tokenHash のみ保存)。hash は sha256 hex (= 64 char)。
//   - 平文 token は URL に含まれるため、ログ / commit / chat には絶対に貼らない。
//   - usageType / planTier / role は URL に出さず DB 解決する (= 改ざん防止)。
//
// プラン方針: planTier は「課金非連動の付与 snapshot(grant 記録)」。Stripe の
//   subscription / price / checkout / webhook には一切連動しない (= 実課金は既存フローに委譲)。

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";

/** URL に乗せる平文 token (= 32 byte → 43 char URL-safe base64)。 */
export function generateStudioInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** token を DB 検索用の hash に変換 (sha256 hex / 64 char)。 */
export function hashStudioInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 招待URLの有効期限 (= 発行から 7 日)。仕様で固定。 */
export const STUDIO_INVITE_EXPIRES_IN_DAYS = 7;

/** 発行時刻 now から有効期限 (now + 7 日) を算出する。 */
export function resolveStudioInviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + STUDIO_INVITE_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
}

// 招待状態。"accepted" = 単発URL使用済み / "used_up" = 複数回URLが上限到達。
export type StudioInviteState = "active" | "accepted" | "used_up" | "expired" | "revoked" | "none";

/**
 * 招待レコードの状態を判定する。
 *   優先順: none > revoked(=disabled) > accepted(単発使用済み) > expired > used_up(上限到達) > active
 *
 * 後方互換:
 *   - maxUses/usedCount 省略時は単発(maxUses=1, usedCount=0)として扱う。
 *   - 旧データ(maxUses=1)は acceptedAt があれば usedCount に関わらず "accepted"(使用済み)。
 *     → 受諾 route の冪等再アクセス(acceptedByUserId 一致)を従来どおり維持できる。
 *   - 複数回(maxUses>1)は usedCount >= maxUses で "used_up"。
 *  expiresAt は必須 (= 発行時に必ずセット) のため null を考慮しない。
 */
export function studioInviteState(
  invite:
    | { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date; maxUses?: number | null; usedCount?: number | null }
    | null
    | undefined,
  now: Date = new Date(),
): StudioInviteState {
  if (!invite) return "none";
  if (invite.revokedAt) return "revoked";
  const max  = invite.maxUses ?? 1;
  const used = invite.usedCount ?? 0;
  // 単発(maxUses<=1): acceptedAt or 1回以上使用 → 使用済み(従来の "accepted" を維持・期限より優先)。
  if (max <= 1 && (invite.acceptedAt != null || used >= 1)) return "accepted";
  if (now > invite.expiresAt) return "expired";
  // 複数回: 上限到達。
  if (used >= max) return "used_up";
  return "active";
}

/** 発行可能なロール (= owner は URL 招待で配らない / member-invite と同方針)。 */
export const STUDIO_INVITE_ROLES = ["admin", "editor", "tester", "viewer"] as const;

/** 発行可能なプランティア (= PlanTier。課金非連動の grant snapshot)。 */
export const STUDIO_INVITE_PLAN_TIERS = ["basic", "standard", "plus", "pro", "delegated"] as const;

/** 招待アクション区分(統合招待UI 用)。値の最終確定は PR2(UI)で行う。ここでは緩く受ける。 */
export const STUDIO_INVITE_ACTIONS = [
  // 個人
  "register_user", "member_invite", "register_and_member",
  // 法人(business OA)
  "corp_register", "corp_admin_invite", "corp_register_admin",
  "corp_oa_link", "corp_register_admin_oa",
] as const;
export type StudioInviteAction = (typeof STUDIO_INVITE_ACTIONS)[number];

/** 使用上限の上限値(暴発防止)。既定 1。 */
export const STUDIO_INVITE_MAX_USES_LIMIT = 100;

/** 招待URL発行 API の入力スキーマ。invite_action/email/max_uses は任意(未指定は従来=単発・単純付与)。 */
export const issueStudioInviteSchema = z.object({
  oa_id:         z.string().min(1),
  usage_type:    z.enum(["personal", "business"]),
  plan_tier:     z.enum(STUDIO_INVITE_PLAN_TIERS),
  role:          z.enum(STUDIO_INVITE_ROLES).default("viewer"),
  note:          z.string().max(200).optional(),
  invite_action: z.enum(STUDIO_INVITE_ACTIONS).optional(),
  email:         z.string().email().max(255).optional(),
  max_uses:      z.number().int().min(1).max(STUDIO_INVITE_MAX_USES_LIMIT).default(1),
});

/** 平文 token から受諾用 URL を組み立てる (発行直後の表示専用)。 */
export function buildStudioInviteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://app.whale-studio.app").replace(/\/$/, "");
  return `${base}/studio-invites/${token}`;
}
