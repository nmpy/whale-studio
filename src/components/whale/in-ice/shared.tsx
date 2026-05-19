// src/components/whale/in-ice/shared.tsx
//
// Whale in Ice ブランドサイト共通プリミティブ (再設計版)。
//
// 設計方針:
//   - SaaS LP の「カード grid + ピル CTA」を排除し、文芸誌 / 美術館ティザー / 出版社ページ寄りに
//   - SectionHeading は「章扉」風: 細い罫線 + 小さな英字番号 + 大きな和文タイトル
//   - HushLink (アンダーラインのテキストリンク) を主要 CTA として使う
//   - CtaLink は残置 (= 一部用途のため) するが、基本は HushLink を優先
//   - Section 余白を大きく取り、余韻 / 静寂を演出

import type { ReactNode } from "react";

/** セクション全体の wrapper。
 *  上下 padding をしっかり広げ、コンテンツ幅も狭めに取って「読み物」感を強める。 */
export function Section({
  id,
  children,
  className = "",
  narrow = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /** narrow=true で max-w-[680px] (= 縦読み中心のセクション用)、default は 980px */
  narrow?: boolean;
}) {
  return (
    <section
      id={id}
      className={`px-6 md:px-10 lg:px-12 py-28 md:py-40 lg:py-52 ${className}`}
    >
      <div className={`mx-auto w-full ${narrow ? "max-w-[680px]" : "max-w-[980px]"}`}>
        {children}
      </div>
    </section>
  );
}

/** 「章扉」風セクション見出し。
 *  上に「No.01 / About」のような番号 + 英字ラベル (細く小さく)、
 *  下に大きな和文タイトル。塗りつぶし / 矩形 / 帯は一切使わない。 */
export function SectionHeading({
  number,
  eyebrow,
  title,
  lead,
}: {
  /** 「No.01」「No.02」等の章番号 (省略可)。 */
  number?: string;
  /** 英字ラベル (例: "About" / "Services") */
  eyebrow?: string;
  /** 和文の大きなタイトル */
  title?: ReactNode;
  /** タイトル直下のリード文 (省略可、subtitle の代わり) */
  lead?: ReactNode;
}) {
  return (
    <header className="mb-14 md:mb-20 lg:mb-24">
      {(number || eyebrow) && (
        <div className="flex items-center gap-4 mb-6 md:mb-8 text-[color:var(--ice-accent)]">
          {number && (
            <span className="ice-serif text-[11px] md:text-[12px] tracking-[0.12em] opacity-80">
              {number}
            </span>
          )}
          {(number && eyebrow) && (
            <span
              aria-hidden="true"
              className="inline-block h-px flex-1 max-w-[64px]"
              style={{ background: "var(--ice-accent)", opacity: 0.4 }}
            />
          )}
          {eyebrow && (
            <span className="text-[10px] md:text-[11px] tracking-[0.36em] uppercase">
              {eyebrow}
            </span>
          )}
        </div>
      )}
      {title && (
        <h2 className="ice-serif text-[26px] md:text-[34px] lg:text-[40px] leading-[1.45] font-bold text-[color:var(--ice-text)] max-w-[760px]">
          {title}
        </h2>
      )}
      {lead && (
        <p className="ice-serif italic text-[15px] md:text-[17px] leading-[1.95] text-[color:var(--ice-text-muted)] mt-6 md:mt-7 max-w-[640px]">
          {lead}
        </p>
      )}
    </header>
  );
}

/** 控えめなセパレータ (1 本の hairline)。
 *  セクション内 / 項目間で使う。 */
export function Hairline({ className = "" }: { className?: string }) {
  return (
    <hr
      className={`border-0 ${className}`}
      style={{ borderTop: "1px solid var(--ice-border)" }}
    />
  );
}

/** ボタンではない、線で押せる CTA。「アンダーラインのテキストリンク」。
 *  SaaS LP のボタンを排除し、文芸ページの "see more" 感を出す。 */
export function HushLink({
  href,
  children,
  external = false,
  size = "md",
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  /** sm: 小さなフッターリンク / md: 通常 / lg: Contact の最終 CTA 用大型 */
  size?: "sm" | "md" | "lg";
}) {
  const sizeCls =
    size === "lg" ? "text-[16px] md:text-[18px] tracking-[0.05em]" :
    size === "sm" ? "text-[11px] md:text-[12px] tracking-[0.18em] uppercase" :
                    "text-[13px] md:text-[14px] tracking-[0.08em]";
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`inline-flex items-center gap-2 ${sizeCls} text-[color:var(--ice-text)] hover:text-[color:var(--ice-accent)] underline underline-offset-[8px] decoration-[color:var(--ice-border-strong)] hover:decoration-[color:var(--ice-accent)] transition-colors duration-200`}
    >
      <span>{children}</span>
      {external ? <ArrowOut /> : <Arrow />}
    </a>
  );
}

/** @deprecated 再設計後は HushLink を優先。CtaLink は残置だが Contact / Hero では使わない。 */
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
      ? "text-[color:var(--ice-ink)] border border-[color:var(--ice-border-strong)] hover:bg-white"
      : "border border-[color:var(--ice-border-strong)] text-[color:var(--ice-text)] hover:bg-[color:var(--ice-surface)]";
  const inlineStyle =
    variant === "primary"
      ? { background: "var(--ice-accent-strong)" }
      : undefined;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${baseCls} ${styleCls}`} style={inlineStyle}>
        {children}
        <ArrowOut />
      </a>
    );
  }
  return (
    <a href={href} className={`${baseCls} ${styleCls}`} style={inlineStyle}>
      {children}
      <Arrow />
    </a>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function ArrowOut() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7" />
      <polyline points="9 7 17 7 17 15" />
    </svg>
  );
}
