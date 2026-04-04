// src/lib/billing-tracker.ts
// 課金イベントをサーバーに送信するクライアント utility。
// fire-and-forget — エラーは握りつぶす（計測失敗でユーザー操作を止めない）。

import type { BillingEvent } from "@/lib/constants/billing-events";

/**
 * 課金イベントを非同期で記録する。
 * 呼び出し元は await 不要。エラーは無視される。
 *
 * @param event    記録するイベント種別
 * @param token    Authorization ヘッダー用トークン（省略可）
 * @param source   流入元・補助情報（例: "header" / "banner" / "gate" / "preview"）
 * @param context  プラン遷移コンテキスト（省略可）
 *                 - from: 現在プラン名（例: "tester"）
 *                 - to:   アップグレード先プラン名（例: "editor"）
 */
export function trackBillingEvent(
  event:    BillingEvent,
  token?:   string,
  source?:  string,
  context?: { from?: string; to?: string },
): void {
  fetch("/api/billing-events", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      event,
      ...(source            != null ? { source }                    : {}),
      ...(context?.from     != null ? { from_plan: context.from }   : {}),
      ...(context?.to       != null ? { to_plan:   context.to   }   : {}),
    }),
  }).catch(() => {});
}
