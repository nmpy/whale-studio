// src/lib/pricing-url.ts
// pricing ページへの URL を組み立てる共通ユーティリティ。
//
// 使用箇所:
//   - PlanCard                    (source=settings)
//   - WorkLimitCard               (source=banner | gate | preview)
//   - works ヘッダー               (source=header)
//   - checkout-session cancel_url (source=checkout, oaId 付き)
//
// クエリパラメータ:
//   source — 流入元 UI ("header" | "banner" | "gate" | "preview" | "settings" | "checkout")
//   from   — 現在プランのコード名 ("tester" など)
//   to     — アップグレード先プランのコード名 ("editor" など)
//   oaId   — Stripe Checkout のキャンセル時に申込先 OA を復元するために使用

export function buildPricingUrl(options: {
  source?: string;
  from?:   string;
  to?:     string;
  oaId?:   string;
}): string {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.from)   params.set("from",   options.from);
  if (options.to)     params.set("to",     options.to);
  if (options.oaId)   params.set("oa_id",  options.oaId);
  const qs = params.toString();
  return qs ? `/pricing?${qs}` : "/pricing";
}
