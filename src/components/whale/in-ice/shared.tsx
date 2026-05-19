// src/components/whale/in-ice/shared.tsx
//
// Whale in Ice ブランドサイト共通の小コンポーネント。
//
// 設計方針 (UI polish 版):
//   - SectionHeading は「展示室のキャプションラベル」風に: 細い水平線 + 小さな英字 + 大きな和文
//   - 白い大きな帯にしない (= 大きな矩形を出さない、塗りつぶしを使わない)
//   - 余白を広めに取る
//   - CTA は frosted-glass 寄りの "氷の白" ボタン。LINE / Studio 系の緑感を排除

import type { ReactNode } from "react";

/** セクション全体の wrapper。上下余白とコンテンツ幅を一括管理。
 *  「静かな深海の展示室」感を出すため、上下 padding を広めに取る。 */
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
      className={`px-6 md:px-10 lg:px-12 py-24 md:py-32 lg:py-40 ${className}`}
    >
      <div className="mx-auto w-full max-w-[1100px]">{children}</div>
    </section>
  );
}

/** セクション見出し: 細い線 + 英字 eyebrow + 和文タイトル。
 *  「展示室のキャプション」風。塗りつぶしカードや白い帯にはしない。 */
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
    <header className="mb-12 md:mb-16 lg:mb-20">
      {eyebrow && (
        <div className="flex items-center gap-3 mb-5 md:mb-6">
          <span
            aria-hidden="true"
            className="inline-block w-7 h-px"
            style={{ background: "var(--ice-accent)", opacity: 0.7 }}
          />
          <span className="text-[10px] md:text-[11px] tracking-[0.32em] uppercase text-[color:var(--ice-accent)]">
            {eyebrow}
          </span>
        </div>
      )}
      <h2 className="ice-serif text-[22px] md:text-[28px] lg:text-[32px] leading-[1.45] font-bold text-[color:var(--ice-text)] max-w-[760px]">
        {title}
      </h2>
      {subtitle && (
        <p className="text-[13px] md:text-[14px] leading-[2.0] text-[color:var(--ice-text-faint)] mt-5 max-w-[640px]">
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
  // primary: 氷の白ボタン。LINE / Studio 系の緑感を排除し、半透明オフホワイト + 細い氷色ボーダー。
  // hover は純白へ。
  // ghost:   透明背景 + 氷色ボーダー。
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
