// src/lib/business-invite.ts
// Phase2: 法人招待リンク (business invite link) の token 生成 / hash / 状態判定 /
// 入力バリデーション / 表示ラベルのヘルパー。
//
// セキュリティ方針 (= LiveActorInvite と同一):
//   - 平文 token は DB に保存しない (= tokenHash のみ保存)
//   - hash は sha256 hex (= 64 char)。token 自体が高エントロピー (256 bit) のため固定 hash で十分。
//   - 平文 token は URL に含まれるため、ログ / commit / chat には絶対に貼らない。
//   - plan / role / usageType は URL に出さず DB 解決する (= 改ざん防止)。

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { PLAN_TIER, PLAN_LABELS, type PlanTier } from "@/lib/constants/plans";
import { ROLE_LABELS } from "@/lib/types/permissions";

/** URL に乗せる平文 token (= 32 byte → 43 char URL-safe base64) */
export function generateBusinessInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** token を DB 検索用の hash に変換 (sha256 hex / 64 char) */
export function hashBusinessInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 発行時の既定有効期限 (= 30 日)。null を渡せば無期限。 */
export const DEFAULT_EXPIRES_IN_DAYS = 30;

/** expiresInDays から expiresAt を算出。null / 0 以下は無期限 (= null) を返す。 */
export function resolveExpiresAt(
  expiresInDays: number | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (expiresInDays == null) return null;       // 明示的な無期限
  if (expiresInDays <= 0) return null;          // 0 以下も無期限扱い
  const d = new Date(now);
  d.setDate(d.getDate() + expiresInDays);
  return d;
}

export type BusinessInviteState =
  | "none"      // 該当 link なし
  | "active"    // 有効 (= 期限内・未使用・未失効)
  | "used"      // 申込済み (= 再申請不可)
  | "expired"   // 期限切れ
  | "revoked";  // 無効化済み

/** link の現在状態を判定する。expiresAt=null は無期限 (= 期限切れにならない)。 */
export function businessInviteState(
  link: { expiresAt: Date | null; usedAt: Date | null; revokedAt: Date | null } | null,
  now: Date = new Date(),
): BusinessInviteState {
  if (!link) return "none";
  if (link.revokedAt) return "revoked";
  if (link.usedAt) return "used";
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

// ── 発行時に許可する plan / role の範囲 ──────────────────────────────
// plan は PLAN_TIER 全ティア (basic/standard/plus/pro/delegated) を許可。
// role は admin/editor/viewer のみ (owner/tester は法人付与対象外なので弾く)。

export const BUSINESS_INVITE_PLAN_TIERS = Object.values(PLAN_TIER) as PlanTier[];
export const BUSINESS_INVITE_ROLES = ["admin", "editor", "viewer"] as const;
export type BusinessInviteRole = (typeof BUSINESS_INVITE_ROLES)[number];

/** 発行 API (POST /api/admin/business-invite-links) の入力スキーマ。 */
export const issueBusinessInviteSchema = z.object({
  planTier:      z.enum(BUSINESS_INVITE_PLAN_TIERS as [PlanTier, ...PlanTier[]]),
  role:          z.enum(BUSINESS_INVITE_ROLES),
  // 当面 business 固定だが、将来 personal も扱える余地を残す。
  usageType:     z.enum(["personal", "business"]).default("business"),
  note:          z.string().trim().max(200).optional(),
  // null = 無期限 / 未指定 = 既定 30 日 / 正の整数 = その日数。
  expiresInDays: z.number().int().min(0).max(3650).nullable().optional(),
});
export type IssueBusinessInviteInput = z.infer<typeof issueBusinessInviteSchema>;

/** 申込フォーム送信 (POST /api/business-invite/apply) の入力スキーマ。 */
export const applyBusinessInviteSchema = z.object({
  token:                   z.string().min(1).max(256),
  companyName:             z.string().trim().min(1, "会社名 / 団体名は必須です").max(200),
  contactName:             z.string().trim().min(1, "お名前は必須です").max(120),
  contactEmail:            z.string().trim().email("メールアドレスの形式が正しくありません").max(254),
  lineOfficialAccountName: z.string().trim().max(200).optional(),
  message:                 z.string().trim().max(2000).optional(),
});
export type ApplyBusinessInviteInput = z.infer<typeof applyBusinessInviteSchema>;

/** token 検証 (POST /api/business-invite/validate) の入力スキーマ。 */
export const validateBusinessInviteSchema = z.object({
  token: z.string().min(1).max(256),
});

/** 法人申込の運営対応ステータス。 */
export const BUSINESS_APP_STATUSES = ["pending", "approved", "rejected"] as const;
export type BusinessAppStatus = (typeof BUSINESS_APP_STATUSES)[number];

/** ステータス表示名 (= 未対応 / 承認済み / 却下)。 */
export const BUSINESS_APP_STATUS_LABELS: Record<BusinessAppStatus, string> = {
  pending:  "未対応",
  approved: "承認済み",
  rejected: "却下",
};

/** 申込承認 / 却下 (POST /api/admin/business-invite-applications/[id]/review) の入力スキーマ。
 *  承認 / 却下はステータス変更のみ (= 自動 OA 作成 / 権限付与 / 課金はしない)。 */
export const reviewBusinessApplicationSchema = z.object({
  status:     z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(2000).optional(),
});

// ── 表示ラベル ──────────────────────────────────────────────────────

/** plan tier → 表示名 ("Basic" / "委託プラン" など)。未知は tier をそのまま返す。 */
export function planTierLabel(tier: string): string {
  return (PLAN_LABELS as Record<string, string>)[tier] ?? tier;
}

/** role → 日本語表示名 ("管理者" など)。未知は role をそのまま返す。 */
export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

/** usageType → 日本語表示名。 */
export function usageTypeLabel(usageType: string): string {
  return usageType === "business" ? "法人利用" : usageType === "personal" ? "個人利用" : usageType;
}
