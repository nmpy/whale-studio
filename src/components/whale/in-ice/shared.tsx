// src/components/whale/in-ice/shared.tsx
//
// Whale in Ice ブランドサイト共通の小コンポーネント。
// 重い state は持たない。layout で定義した CSS 変数 (--ice-*) と Tailwind v4 utilities を併用する。

import type { ReactNode } from "react";

/** セクション全体の wrapper。上下余白とコンテンツ幅を一括管理。 */
export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`px-6 md:px-10 lg:px-12 py-20 md:py-28 lg:py-32 ${className}`}
    >
      <div className="mx-auto w-full max-w-[1100px]">{children}</div>
    </section>
  );
}

/** セクション見出し: 小見出し (英) + 大見出し (和、Serif)。 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="mb-10 md:mb-14">
      {eyebrow && (
        <p className="text-[11px] md:text-xs tracking-[0.24em] uppercase text-[color:var(--ice-accent)] mb-3">
          {eyebrow}
        </p>
      )}
      <h2 className="ice-serif text-2xl md:text-3xl lg:text-[34px] leading-tight font-bold text-[color:var(--ice-text)]">
        {title}
      </h2>
      {subtitle && (
        <p className="text-[14px] md:text-[15px] leading-[1.9] text-[color:var(--ice-text-muted)] mt-4 max-w-[640px]">
          {subtitle}
        </p>
      )}
    </header>
  );
}

/** 控えめなセパレータ (ライン)。 */
export function Divider() {
  return <hr className="border-t border-[color:var(--ice-border)] my-0" />;
}

/** プライマリ寄りの控えめ CTA。塗りすぎない、押せることが分かる程度。 */
export function CtaLink({
  href,
  children,
  external = false,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  variant?: "primary" | "ghost";
}) {
  const baseCls = "inline-flex items-center gap-2 text-[14px] md:text-[15px] font-medium px-5 md:px-6 py-3 rounded-full transition-colors duration-200";
  const styleCls =
    variant === "primary"
      ? "bg-[color:var(--ice-accent-strong)] text-[color:var(--ice-ink)] hover:bg-white"
      : "border border-[color:var(--ice-border-strong)] text-[color:var(--ice-text)] hover:bg-[color:var(--ice-surface)]";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${baseCls} ${styleCls}`}>
        {children}
        <ArrowOut />
      </a>
    );
  }
  return (
    <a href={href} className={`${baseCls} ${styleCls}`}>
      {children}
      <Arrow />
    </a>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function ArrowOut() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7" />
      <polyline points="9 7 17 7 17 15" />
    </svg>
  );
}
