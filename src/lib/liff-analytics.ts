// src/lib/liff-analytics.ts
// LIFF（特にヒントサイト）からの軽量分析ログ。
// fire-and-forget で動作し、失敗しても表示には影響しない。

export type HintSiteEventName =
  | "page_view"
  | "accordion_open"
  | "accordion_close"
  | "cta_click";

export interface HintSiteEventPayload {
  work_id?: string;
  url?: string;
  label?: string;
  block_id?: string;
  source?: string;
  depth?: number;
  [k: string]: unknown;
}

/**
 * ヒントサイトのクライアント側分析イベントを発火する。
 *
 * - SSR 中（typeof window === "undefined"）は no-op。
 * - window.__hintSiteAnalytics?.push() があればそちらに渡す。
 * - 開発モードでは console.debug で確認できる。
 */
export function trackHintSiteEvent(name: HintSiteEventName, payload: HintSiteEventPayload = {}): void {
  if (typeof window === "undefined") return;
  try {
    const w = window as unknown as { __hintSiteAnalytics?: { push?: (e: { name: string; payload: unknown; ts: number }) => void } };
    w.__hintSiteAnalytics?.push?.({ name, payload, ts: Date.now() });
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[hint-site] ${name}`, payload);
    }
  } catch {
    // 何もしない — 分析ログは UI を阻害しない
  }
}
