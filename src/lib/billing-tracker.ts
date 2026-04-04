// src/lib/billing-tracker.ts
// 課金イベントをサーバーに送信するクライアント utility。
// fire-and-forget — エラーは握りつぶす（計測失敗でユーザー操作を止めない）。

import type { BillingEvent } from "@/lib/constants/billing-events";

/**
 * 課金イベントを非同期で記録する。
 * 呼び出し元は await 不要。エラーは無視される。
 *
 * @param event   記録するイベント種別
 * @param token   Authorization ヘッダー用トークン（省略可）
 * @param source  流入元・補助情報（例: "header" / "banner" / "gate" / "preview"）
 */
export function trackBillingEvent(
  event:   BillingEvent,
  token?:  string,
  source?: string,
): void {
  fetch("/api/billing-events", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      event,
      ...(source != null ? { source } : {}),
    }),
  }).catch(() => {});
}
