// src/app/pricing/page.tsx
// プランページ — Server Component ラッパー
//
// useSearchParams() を使う PricingContent を Suspense でラップすることで、
// Next.js 14 App Router の "useSearchParams() should be wrapped in a suspense
// boundary" ビルドエラーを解消する。
//
// 構成:
//   page.tsx     — Server Component（このファイル）: Suspense でラップ
//   _content.tsx — Client Component: useSearchParams / useRouter / イベント記録

import { Suspense } from "react";
import { PricingContent } from "./_content";

// ── ローディングフォールバック ────────────────────────────────────────
// Suspense の fallback。useSearchParams の解決を待つ間（SSR shell）表示される。
function PricingFallback() {
  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 0 64px" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div className="skeleton" style={{ width: 180, height: 28, borderRadius: 999, margin: "0 auto 16px" }} />
        <div className="skeleton" style={{ width: 300, height: 34, margin: "0 auto 10px" }} />
        <div className="skeleton" style={{ width: 260, height: 18, margin: "0 auto 6px" }} />
        <div className="skeleton" style={{ width: 220, height: 18, margin: "0 auto" }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ flex: "1 1 140px", height: 44, borderRadius: 10 }} />
        ))}
      </div>
      <div className="skeleton" style={{ width: "100%", height: 160, borderRadius: 10, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: "100%", height: 140, borderRadius: 10, marginBottom: 28 }} />
      <div className="skeleton" style={{ width: "100%", height: 240, borderRadius: 10 }} />
    </div>
  );
}

// ── ページ default export（Server Component）────────────────────────
export default function PricingPage() {
  return (
    <Suspense fallback={<PricingFallback />}>
      <PricingContent />
    </Suspense>
  );
}
