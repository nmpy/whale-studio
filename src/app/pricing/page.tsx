// src/app/pricing/page.tsx
// プランページ — Server Component ラッパー
//
// Next.js App Router では Page コンポーネントが searchParams を props として受け取れる。
// searchParams を Server Component 側で受け取り、Client Component（PricingContent）へ
// props として渡すことで useSearchParams() 依存を排除し、Suspense 要件を最小化する。
//
// 構成:
//   page.tsx     — Server Component（このファイル）: searchParams を受け取り props で渡す
//   _content.tsx — Client Component: useIsMobile / useState / useEffect / イベント記録

import { Suspense } from "react";
import { PricingContent } from "./_content";

// ── ローディングフォールバック ────────────────────────────────────────
// Client Component のハイドレーション前に表示されるスケルトン。
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
// searchParams は Next.js が Request 時に注入するため、useSearchParams() 不要。
// oa_id  — Stripe Checkout のキャンセル時に pricing へ戻る際に付与される OA ID
// canceled — "1" のとき Stripe Checkout からのキャンセル戻りを示す
export default function PricingPage({
  searchParams,
}: {
  searchParams: {
    source?:   string;
    from?:     string;
    to?:       string;
    oa_id?:    string;
    canceled?: string;
  };
}) {
  return (
    <Suspense fallback={<PricingFallback />}>
      <PricingContent
        source={searchParams.source}
        from={searchParams.from}
        to={searchParams.to}
        oaId={searchParams.oa_id}
        canceled={searchParams.canceled}
      />
    </Suspense>
  );
}
