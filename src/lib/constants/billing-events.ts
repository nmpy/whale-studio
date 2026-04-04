// src/lib/constants/billing-events.ts
// 課金導線イベント定数

export const BILLING_EVENTS = [
  "pricing_view",
  "pricing_click_from_header",
  "pricing_click_from_banner",
  "pricing_click_from_gate",
  "pricing_click_from_preview",
  "pricing_cta_click",
  "pricing_feedback_submit",
] as const;

export type BillingEvent = (typeof BILLING_EVENTS)[number];

/** UI 表示用ラベル */
export const BILLING_EVENT_LABELS: Record<BillingEvent, string> = {
  pricing_view:               "プランページ到達",
  pricing_click_from_header:  "ヘッダーから遷移",
  pricing_click_from_banner:  "バナーから遷移",
  pricing_click_from_gate:    "ゲートから遷移",
  pricing_click_from_preview: "プレビュー後から遷移",
  pricing_cta_click:          "CTA クリック（このプランを使う）",
  pricing_feedback_submit:    "フィードバック送信完了",
};
