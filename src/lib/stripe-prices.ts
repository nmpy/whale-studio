// src/lib/stripe-prices.ts
// 個人プラン (PlanTier) → Stripe price ID マッピング。
//
// price ID は環境変数で管理する。未設定のプランは「準備中」として 400 を返す
// (= ユーザーに分かるエラー)。500 にはしない。

import type { PlanTier } from "@/lib/constants/plans";

/** plan key → Stripe price ID。未設定の plan は undefined を返す。 */
export function getPriceIdForPlan(plan: PlanTier): string | undefined {
  switch (plan) {
    case "basic":    return process.env.STRIPE_PRICE_BASIC;
    case "standard": return process.env.STRIPE_PRICE_STANDARD;
    case "pro":      return process.env.STRIPE_PRICE_PRO;
    case "plus":     return process.env.STRIPE_PRICE_PLUS;
  }
}

/** Checkout 後にユーザーを戻すアプリの公開 URL。
 *  NEXT_PUBLIC_APP_URL が未設定なら request origin にフォールバックする呼び出し側で対応する。 */
export function getAppUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL;
}
