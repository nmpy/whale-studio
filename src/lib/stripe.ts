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

/** Stripe が設定済みかどうかを確認する（UI の表示制御用）。 */
export function isStripeConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_EDITOR_PRICE_ID &&
    process.env.STRIPE_WEBHOOK_SECRET
  );
}
