// src/components/whale/lp-v2/shared.tsx
//
// Whale Studio 新 LP (確認用) の共通パーツ。
// 重い state は持たない。layout で定義した CSS 変数 (--ws-*) と Tailwind v4 utilities を併用する。

import type { ReactNode } from "react";

/** 新規登録の入口。
 *  src/app/login/page.tsx が「STUDIO LP からの ?mode=register 遷移」を正式にサポートしているため、
 *  LP の主 CTA はこの契約に合わせる (= 認証処理側は一切変更しない)。 */
export const REGISTER_HREF = "/login?mode=register";

/** ログイン導線。 */
export const LOGIN_HREF = "/login";

/** 料金の詳細は既存 /pricing に集約する (LP 側で価格を二重管理しない)。 */
export const PRICING_HREF = "/pricing";

/** セクション wrapper。上下余白とコンテンツ幅を一括管理。 */
export function Section({
  id,
  children,
  tint = false,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  /** true で薄いグレー面にする (セクション交互の塗り分け用)。 */
  tint?: boolean;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`px-6 md:px-10 lg:px-12 py-20 md:py-24 lg:py-28 ${
        tint ? "bg-[color:var(--ws-bg-tint)]" : ""
      } ${className}`}
    >
      <div className="mx-auto w-full max-w-[1080px]">{children}</div>
    </section>
  );
}

/** セクション見出し: 小見出し (英) + 大見出し (和) + 補足。 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "left",
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "left" | "center";
}) {
  const isCenter = align === "center";
  return (
    <header className={`mb-10 md:mb-14 ${isCenter ? "text-center" : ""}`}>
      {eyebrow && (
        <p className="text-[11px] md:text-xs tracking-[0.24em] uppercase text-[color:var(--ws-navy-soft)] mb-3">
          {eyebrow}
        </p>
      )}
      <h2 className="text-[24px] md:text-[32px] lg:text-[36px] leading-[1.35] font-bold text-[color:var(--ws-text)]">
        {title}
      </h2>
      {subtitle && (
        <p
          className={`text-[14px] md:text-[15px] leading-[1.95] text-[color:var(--ws-text-muted)] mt-4 max-w-[660px] ${
            isCenter ? "mx-auto" : ""
          }`}
        >
          {subtitle}
        </p>
      )}
    </header>
  );
}

/** CTA。primary = ブランドネイビー塗り / ghost = 枠線のみ。 */
export function CtaLink({
  href,
  children,
  variant = "primary",
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  external?: boolean;
}) {
  const baseCls =
    "inline-flex items-center gap-2 text-[14px] md:text-[15px] font-semibold px-6 md:px-7 py-3.5 rounded-full transition-colors duration-200";
  const styleCls =
    variant === "primary"
      ? "bg-[color:var(--ws-navy)] text-white hover:bg-[color:var(--ws-navy-deep)]"
      : "border border-[color:var(--ws-border-strong)] text-[color:var(--ws-text)] hover:bg-[color:var(--ws-bg-tint)]";

  const externalProps = external
    ? { target: "_blank", rel: "noopener noreferrer" as const }
    : {};

  return (
    <a href={href} className={`${baseCls} ${styleCls}`} {...externalProps}>
      {children}
      <Arrow />
    </a>
  );
}

function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

/** 「準備中」等の状態を示す小さなバッジ。 */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "line";
}) {
  const toneCls = {
    neutral: "bg-[color:var(--ws-bg-tint)] text-[color:var(--ws-text-faint)] border-[color:var(--ws-border)]",
    brand: "bg-[color:var(--ws-navy)]/8 text-[color:var(--ws-navy)] border-[color:var(--ws-navy)]/20",
    line: "bg-[color:var(--ws-line-green)]/10 text-[#04833A] border-[color:var(--ws-line-green)]/30",
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] md:text-[11px] font-semibold tracking-[0.06em] ${toneCls}`}
    >
      {children}
    </span>
  );
}
