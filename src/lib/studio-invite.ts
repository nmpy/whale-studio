// src/lib/studio-invite.ts
// スタジオ管理から発行する「招待URL」(StudioInvite) の token 生成 / hash / 有効期限 / 入力スキーマ。
//
// セキュリティ方針 (= member-invite / business-invite と同一):
//   - 平文 token は DB に保存しない (= tokenHash のみ保存)。hash は sha256 hex (= 64 char)。
//   - 平文 token は URL に含まれるため、ログ / commit / chat には絶対に貼らない。
//   - usageType / planTier / role は URL に出さず DB 解決する (= 改ざん防止)。
//
// 注: UI と共通の純ロジック/定数（roles / plan tiers / actions / 状態判定 / scope 等）は
//     client からも import できるよう studio-invite-ui.ts に分離した（node:crypto を含めないため）。
//     ここでは後方互換のため re-export する。

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import {
  STUDIO_INVITE_ROLES, STUDIO_INVITE_PLAN_TIERS, STUDIO_INVITE_ACTIONS,
  STUDIO_INVITE_MAX_USES_LIMIT, STUDIO_INVITE_EXPIRES_IN_DAYS, STUDIO_INVITE_MAX_EXPIRES_DAYS,
} from "./studio-invite-ui";

// UI と共通の純ロジック/定数を再 export（既存 import 互換）。
export {
  STUDIO_INVITE_ROLES, STUDIO_INVITE_PLAN_TIERS, STUDIO_INVITE_ACTIONS,
  STUDIO_INVITE_MAX_USES_LIMIT, STUDIO_INVITE_EXPIRES_IN_DAYS, STUDIO_INVITE_MAX_EXPIRES_DAYS,
  STUDIO_INVITE_EXPIRES_OPTIONS, INVITE_ACTIONS_BY_SCOPE, INVITE_ACTION_LABELS,
  scopeUsageType, inviteActionRequiresRole, studioInviteState,
} from "./studio-invite-ui";
export type { StudioInviteAction, InviteScope, StudioInviteState } from "./studio-invite-ui";

/** URL に乗せる平文 token (= 32 byte → 43 char URL-safe base64)。 */
export function generateStudioInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** token を DB 検索用の hash に変換 (sha256 hex / 64 char)。 */
export function hashStudioInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 発行時刻 now から有効期限 (now + days 日) を算出する。days 省略時は既定 7 日 (= 従来挙動)。 */
export function resolveStudioInviteExpiresAt(now: Date, days: number = STUDIO_INVITE_EXPIRES_IN_DAYS): Date {
  const d = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), STUDIO_INVITE_MAX_EXPIRES_DAYS) : STUDIO_INVITE_EXPIRES_IN_DAYS;
  return new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
}

/** 招待URL発行 API の入力スキーマ。invite_action/email/max_uses/expires_in_days は任意(未指定は従来挙動)。 */
export const issueStudioInviteSchema = z.object({
  oa_id:           z.string().min(1),
  usage_type:      z.enum(["personal", "business"]),
  plan_tier:       z.enum(STUDIO_INVITE_PLAN_TIERS),
  role:            z.enum(STUDIO_INVITE_ROLES).default("viewer"),
  note:            z.string().max(200).optional(),
  invite_action:   z.enum(STUDIO_INVITE_ACTIONS).optional(),
  email:           z.string().email().max(255).optional(),
  max_uses:        z.number().int().min(1).max(STUDIO_INVITE_MAX_USES_LIMIT).default(1),
  expires_in_days: z.number().int().min(1).max(STUDIO_INVITE_MAX_EXPIRES_DAYS).default(STUDIO_INVITE_EXPIRES_IN_DAYS),
});

/** 平文 token から受諾用 URL を組み立てる (発行直後の表示専用)。 */
export function buildStudioInviteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://app.whale-studio.app").replace(/\/$/, "");
  return `${base}/studio-invites/${token}`;
}
