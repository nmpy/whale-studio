// src/components/liff/ticket-link/TicketLinkStepHeading.tsx
//
// 各画面の見出し。左に「チケット連携」、右端に進行表示（例 `2 / 4`）、その下に説明文。
// 進行表示は入口(choice)・完了(done)では出さない（呼び出し側が null を渡す）。
//
// ルートは **`<header>` ではなく `<div>`**。理由は 2 つ:
//   1. globals.css の unlayered な `header { box-shadow / border-bottom / position:sticky /
//      z-index / 半透明 background / backdrop-filter }` が素通しで当たってしまう。
//      Tailwind の打ち消し（@layer utilities）は unlayered な要素セレクタに負けるため、
//      要素を変えて発生源から切り離すのが最小かつ確実。
//   2. この要素の祖先は div だけなので、`<header>` だと暗黙で role="banner"（ページ全体の
//      バナー）として公開されてしまう。ここは各ステップの見出しであり banner ではない。
// 見出し構造は内部の <h2> が担うため、div 化しても文書構造は変わらない。

import type { ReactNode } from "react";

interface Props {
  title: string;
  /** 例 "2 / 4"。表示しない画面では null。 */
  indicator?: string | null;
  description?: ReactNode;
}

export function TicketLinkStepHeading({ title, indicator, description }: Props) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 break-words text-[19px] font-bold leading-[1.4] text-[color:var(--liff-primary-text,#1F2329)]">
          {title}
        </h2>
        {indicator && (
          <p
            className="shrink-0 text-[12.5px] leading-[1.4] text-[color:var(--liff-tertiary-text,#8C8C8C)]"
            aria-label={`ステップ ${indicator.replace(" / ", " / 全 ")}`}
          >
            {indicator}
          </p>
        )}
      </div>
      {description && (
        <p className="mt-2 whitespace-pre-line break-words text-[13.5px] leading-[1.7] text-[color:var(--liff-secondary-text,#5B6168)]">
          {description}
        </p>
      )}
    </div>
  );
}
