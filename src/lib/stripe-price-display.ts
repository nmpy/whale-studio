// src/lib/stripe-price-display.ts
//
// /pricing ページの価格表示用に、Stripe Price API から金額をサーバーサイドで取得する helper。
//
// 設計方針:
//   - server-side 専用 (= STRIPE_SECRET_KEY を使う / クライアントには出さない)
//   - 取得失敗時は fallback `"お問い合わせください"` を返し、ページが落ちないようにする
//   - env 未設定 (= STRIPE_SECRET_KEY / STRIPE_PRICE_<TIER> 不在) でも fallback で動く
//   - 既存 Checkout / webhook ロジックは変更しない (= Price ID 解決経路は同じ)
//
// 戻り値:
//   { formatted: "¥5,400" | "お問い合わせください", priceUnit: "/ 月" | "/ 年" | "" }

import { getStripe, isStripeCheckoutConfigured } from "@/lib/stripe";
import { getPriceIdForPlan } from "@/lib/stripe-prices";
import type { PlanTier } from "@/lib/constants/plans";

export interface PlanPriceDisplay {
  /** UI に表示する金額文字列。取得失敗時は "お問い合わせください" */
  formatted: string;
  /** "/ 月" or "/ 年" or "" (= 取得失敗 / 単発価格) */
  priceUnit: string;
}

const FALLBACK: PlanPriceDisplay = {
  formatted: "お問い合わせください",
  priceUnit: "",
};

/** 単一プランの価格を取得 (= 失敗時は fallback)。 */
export async function fetchPlanPriceDisplay(plan: PlanTier): Promise<PlanPriceDisplay> {
  // env 未設定 → fallback
  if (!isStripeCheckoutConfigured()) return FALLBACK;
  const priceId = getPriceIdForPlan(plan);
  if (!priceId) return FALLBACK;

  try {
    const stripe = getStripe();
    const price  = await stripe.prices.retrieve(priceId);

    if (price.unit_amount == null) return FALLBACK;

    const currency = (price.currency ?? "jpy").toLowerCase();
    // JPY は最小単位 = 1 円 / USD 等は最小単位 = セント (= 100 で割る)
    const amount = currency === "jpy" ? price.unit_amount : price.unit_amount / 100;

    const formatter = new Intl.NumberFormat("ja-JP", {
      style:                  "currency",
      currency:               currency.toUpperCase(),
      maximumFractionDigits:  0,
    });
    const formatted = formatter.format(amount);

    const interval = price.recurring?.interval;
    const priceUnit =
      interval === "year"  ? "/ 年"
      : interval === "month" ? "/ 月"
      : "";

    return { formatted, priceUnit };
  } catch (err) {
    // Stripe API エラー時もページを落とさず fallback
    // 注意: webhook URL / secret key 等は throw メッセージに含まれないよう
    //       err.message のみ採用 (= 上位 console.warn で記録 / クライアントには伝えない)
    console.warn(
      `[pricing] failed to fetch Stripe price for plan=${plan}:`,
      err instanceof Error ? err.message : err,
    );
    return FALLBACK;
  }
}

/** 全プランの価格を並列取得。
 *  delegated（委託プラン）は Stripe checkout を持たない（相談ベース）ため FALLBACK 固定。 */
export async function fetchAllPlanPrices(): Promise<Record<PlanTier, PlanPriceDisplay>> {
  const [basic, standard, plus, pro] = await Promise.all([
    fetchPlanPriceDisplay("basic"),
    fetchPlanPriceDisplay("standard"),
    fetchPlanPriceDisplay("plus"),
    fetchPlanPriceDisplay("pro"),
  ]);
  return { basic, standard, plus, pro, delegated: FALLBACK };
}
