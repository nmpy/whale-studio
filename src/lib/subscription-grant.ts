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

import { mapPlanNameToTier, isPlanTier, type PlanTier } from "@/lib/constants/plans";

export type GrantType = "beta" | "trial" | null;

/** full access（= plan の tier をそのまま使う）を許可する status。
 *  beta は status=active で運用するが、明示的に許可しておく。 */
const FULL_ACCESS_STATUSES = new Set(["active", "trialing", "beta"]);

export type SubLike = {
  status: string;
  grantType?: string | null;
  trialEndsAt?: Date | string | null;
  planName?: string | null;
  // ── 手動上書き（manual override・Stripe 非連動・PR3）──
  // Stripe 由来フィールドとは完全に分離。すべて省略/null なら従来挙動と完全一致。
  manualPlanTier?: string | null;
  manualStartsAt?: Date | string | null;
  manualEndsAt?: Date | string | null;
  manualDisabledAt?: Date | string | null;
};

/**
 * 有効な手動上書きの tier を返す（無効/未設定/不正値なら null＝存在しないものとして扱う）。
 *   有効条件: manualPlanTier が有効な PlanTier ＆ manualDisabledAt==null
 *            ＆ (manualStartsAt==null || now>=manualStartsAt) ＆ (manualEndsAt==null || now<manualEndsAt)
 *   - 境界: now===manualStartsAt は有効 / now===manualEndsAt は無効。
 *   - 不正な manualPlanTier は「無効扱い」＝null を返す（即 basic 固定にはしない＝呼び出し側でフォールバック）。
 */
export function manualOverrideTier(
  sub: SubLike | null | undefined,
  now: number = Date.now(),
): PlanTier | null {
  if (!sub) return null;
  const tier = sub.manualPlanTier;
  if (!isPlanTier(tier)) return null;                 // 未設定/不正値 → 無効扱い
  if (sub.manualDisabledAt) return null;              // 無効化済み
  if (sub.manualStartsAt && new Date(sub.manualStartsAt).getTime() > now) return null; // 開始前
  if (sub.manualEndsAt && new Date(sub.manualEndsAt).getTime() <= now) return null;    // 終了済み
  return tier;
}

/** 有効な手動上書きがあるか。 */
export function isManualOverrideActive(sub: SubLike | null | undefined, now: number = Date.now()): boolean {
  return manualOverrideTier(sub, now) !== null;
}

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
 *   解決順: 有効な手動上書き > beta/trial（既存）> Stripe/通常(status full access) > basic
 *   - 有効な手動上書きがあれば最優先（Stripe active でも手動が勝つ。Stripe フィールドは不変）。
 *   - 手動が無効/未設定/不正値なら従来ロジックへフォールバック（トライアル失効→basic / full access 以外→basic /
 *     それ以外→plan.name の tier）。manual_* が全 null のときは従来挙動と完全一致。
 * sub が無い場合は basic。
 */
export function effectiveTierFromSub(
  sub: SubLike | null | undefined,
  now: number = Date.now(),
): PlanTier {
  if (!sub) return mapPlanNameToTier(null);
  const manual = manualOverrideTier(sub, now);
  if (manual) return manual;                          // 手動上書き最優先（不正値はここで null＝フォールバック）
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
