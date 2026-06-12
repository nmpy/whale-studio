// src/lib/subscription-grant.ts
//
// β版 / 7日トライアルの判定純ロジック（client / server 両用・node 依存なし）。
//
// 内部表現:
//   - grantType="beta"  : β版（無期限・Pro Max 相当）。trialEndsAt=null。期限切れにならない。
//   - grantType="trial" : 7日トライアル。trialEndsAt を過ぎたら basic 相当にフォールバック。
//   - grantType=null    : 通常 / Stripe（既存どおり）。
//
// feature gate の期限判定は **trialEndsAt を正**とする（currentPeriodEnd は使わない）。
// Stripe には一切連動しない。

import { mapPlanNameToTier, type PlanTier } from "@/lib/constants/plans";

export type GrantType = "beta" | "trial" | null;

/** full access（= plan の tier をそのまま使う）を許可する status。
 *  beta は status=active で運用するが、明示的に許可しておく。 */
const FULL_ACCESS_STATUSES = new Set(["active", "trialing", "beta"]);

export type SubLike = {
  status: string;
  grantType?: string | null;
  trialEndsAt?: Date | string | null;
  planName?: string | null;
};

/** β版か。 */
export function isBeta(grantType: string | null | undefined): boolean {
  return grantType === "beta";
}

/** トライアル中（期限内）か。 */
export function isTrialActive(
  grantType: string | null | undefined,
  trialEndsAt: Date | string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (grantType !== "trial") return false;
  if (!trialEndsAt) return true; // 期限未設定の trial は有効扱い（防御的）
  return new Date(trialEndsAt).getTime() > now;
}

/** トライアル失効済みか（grantType=trial かつ trialEndsAt 過去）。 */
export function isTrialExpired(
  grantType: string | null | undefined,
  trialEndsAt: Date | string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (grantType !== "trial") return false;
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() <= now;
}

/**
 * サブスクから「実効プランティア」を決定する。
 *   - トライアル失効 → basic
 *   - status が full access 以外 → basic
 *   - それ以外 → plan.name の tier（β版は plan=pro なので Pro Max 相当）
 * sub が無い場合は basic。
 */
export function effectiveTierFromSub(
  sub: SubLike | null | undefined,
  now: number = Date.now(),
): PlanTier {
  if (!sub) return mapPlanNameToTier(null);
  if (isTrialExpired(sub.grantType, sub.trialEndsAt, now)) return mapPlanNameToTier(null);
  if (!FULL_ACCESS_STATUSES.has(sub.status)) return mapPlanNameToTier(null);
  return mapPlanNameToTier(sub.planName ?? null);
}

/** UI 表示用の「付与状態」種別。 */
export type GrantDisplayKind = "beta" | "trial_active" | "trial_expired" | "normal";

export function grantDisplayKind(sub: SubLike | null | undefined, now: number = Date.now()): GrantDisplayKind {
  if (!sub) return "normal";
  if (isBeta(sub.grantType)) return "beta";
  if (isTrialActive(sub.grantType, sub.trialEndsAt, now)) return "trial_active";
  if (isTrialExpired(sub.grantType, sub.trialEndsAt, now)) return "trial_expired";
  return "normal";
}

/** トライアル終了日を YYYY/MM/DD (JST) で返す。null は null。 */
export function formatTrialEndDate(trialEndsAt: Date | string | null | undefined): string | null {
  if (!trialEndsAt) return null;
  try {
    return new Date(trialEndsAt).toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    return null;
  }
}
