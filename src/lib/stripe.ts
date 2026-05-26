// src/lib/stripe.ts
// Stripe クライアントのシングルトン。
//
// - STRIPE_SECRET_KEY が未設定の場合は getStripe() がエラーをスローする。
// - API ルートや Webhook ハンドラは必ず getStripe() 経由で呼び出す。
// - クライアントサイドでは絶対にインポートしない（秘密鍵が漏洩するため）。

import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Stripe クライアントを返す（遅延初期化 + シングルトン）。
 * 環境変数 STRIPE_SECRET_KEY が未設定の場合はエラーをスローする。
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("[stripe] STRIPE_SECRET_KEY が設定されていません。環境変数を確認してください。");
  }
  _stripe = new Stripe(key);
  return _stripe;
}

/** Checkout API が動作可能か (= STRIPE_SECRET_KEY のみ確認)。
 *  Webhook secret は /api/billing/webhook が個別に検証するため、
 *  本関数では要求しない。Webhook 未配線環境でも Checkout の動作確認はできる。
 *  個別プランの price ID 有無は getPriceIdForPlan で別途判定する。 */
export function isStripeCheckoutConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
