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
// 新レイアウト (ヘッダー + コンセプト 3 点 + 個人 4 カード grid + 法人カード) を近似する。
function PricingFallback() {
  return (
    <div className="mx-auto w-full max-w-[640px] px-5 py-6 sm:px-0 sm:py-10">
      {/* ヘッダー */}
      <div className="mb-9 text-center">
        <div className="skeleton mx-auto mb-4" style={{ width: 180, height: 24, borderRadius: 999 }} />
        <div className="skeleton mx-auto mb-2.5" style={{ width: 300, height: 26 }} />
        <div className="skeleton mx-auto mb-1.5" style={{ width: 260, height: 16 }} />
        <div className="skeleton mx-auto" style={{ width: 220, height: 16 }} />
      </div>
      {/* コンセプト 3 点 */}
      <div className="mb-7 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton sm:flex-1 sm:basis-[140px]" style={{ height: 40, borderRadius: 13 }} />
        ))}
      </div>
      {/* 個人 4 カード grid */}
      <div className="skeleton mb-2.5" style={{ width: 100, height: 12 }} />
      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] sm:gap-3.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 240, borderRadius: 20 }} />
        ))}
      </div>
      {/* 法人カード */}
      <div className="skeleton mb-2.5" style={{ width: 100, height: 12 }} />
      <div className="skeleton" style={{ height: 140, borderRadius: 20 }} />
    </div>
  );
}

// ── ページ default export（Server Component）────────────────────────
// searchParams は Next.js が Request 時に注入するため、useSearchParams() 不要。
// oa_id    — Stripe Checkout のキャンセル時に pricing へ戻る際に付与される OA ID
// checkout — "cancelled" のとき Stripe Checkout からのキャンセル戻りを示す
//            (legacy "canceled=1" もサポート)
export default function PricingPage({
  searchParams,
}: {
  searchParams: {
    source?:   string;
    from?:     string;
    to?:       string;
    oa_id?:    string;
    canceled?: string;
    checkout?: string;
  };
}) {
  const isCancelled =
    searchParams.checkout === "cancelled" || searchParams.canceled === "1";
  return (
    <Suspense fallback={<PricingFallback />}>
      <PricingContent
        source={searchParams.source}
        from={searchParams.from}
        to={searchParams.to}
        oaId={searchParams.oa_id}
        canceled={isCancelled ? "1" : undefined}
      />
    </Suspense>
  );
}
