// src/components/liff/ticket-link/TicketLinkStepHeading.tsx
//
// 各画面の見出し。左に「チケット連携」、右端に進行表示（例 `2 / 4`）、その下に説明文。
// 進行表示は入口(choice)・完了(done)では出さない（呼び出し側が null を渡す）。
//
// `liff-tl-heading` は globals.css の unlayered な `header {}` が付けてくる box-shadow を
// 打ち消すためだけの class（実体は liff-font.css）。Tailwind の shadow-none は
// `@layer utilities` にあり unlayered な要素セレクタに負けるため使えない。

import type { ReactNode } from "react";

interface Props {
  title: string;
  /** 例 "2 / 4"。表示しない画面では null。 */
  indicator?: string | null;
  description?: ReactNode;
}

export function TicketLinkStepHeading({ title, indicator, description }: Props) {
  return (
    <header className="liff-tl-heading mb-5">
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
    </header>
  );
}
