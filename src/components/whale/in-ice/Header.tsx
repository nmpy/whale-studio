"use client";

// src/components/whale/in-ice/Header.tsx
//
// /whale/in-ice 専用 sticky ヘッダー。
//   - 半透明濃紺 + backdrop-blur で「氷の上に乗った薄いガラス」のような質感
//   - 左: ブランドロゴ (英 / 和併記、控えめサイズ)
//   - 右: 5 アンカーナビ (About / Services / Case Study / Whale Studio / Contact)
//   - Contact だけ CTA 風に強調 (押せる動線として最優先のため)
//   - SP では nav を畳んで「ロゴ + Contact ボタン」だけにする (混雑回避、ハンバーガーは MVP では入れない)

import type { ReactNode } from "react";

interface NavItem {
  href:  string;
  label: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { href: "#about",       label: "About" },
  { href: "#services",    label: "Services" },
  { href: "#case-study",  label: "Case Study" },
  { href: "#studio",      label: "Whale Studio" },
];

export function Header() {
  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur-md"
      style={{
        background: "rgba(6, 17, 31, 0.72)",
        borderColor: "var(--ice-border)",
      }}
    >
      <div className="mx-auto w-full max-w-[1100px] px-5 md:px-10 lg:px-12 h-[60px] md:h-[68px] flex items-center justify-between gap-4">
        {/* ロゴ */}
        <a
          href="#top"
          className="flex items-center gap-2.5 shrink-0 group"
        >
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--ice-accent)] transition-opacity duration-200 group-hover:opacity-80"
          />
          <span className="flex items-center gap-2 md:gap-2.5">
            <span className="text-[11px] md:text-[12px] tracking-[0.24em] uppercase text-[color:var(--ice-text)]">
              Whale in Ice
            </span>
            <span aria-hidden="true" className="opacity-40 text-[10px] md:text-[11px] text-[color:var(--ice-text-faint)]">
              /
            </span>
            <span className="ice-serif text-[12px] md:text-[13px] tracking-[0.08em] text-[color:var(--ice-text)]">
              氷のくじら
            </span>
          </span>
        </a>

        {/* PC ナビ */}
        <nav aria-label="主要ナビ" className="hidden md:flex items-center gap-6 lg:gap-7">
          {NAV_ITEMS.map((it) => (
            <a
              key={it.href}
              href={it.href}
              className="text-[12px] lg:text-[13px] tracking-[0.16em] uppercase text-[color:var(--ice-text-muted)] hover:text-[color:var(--ice-accent)] transition-colors duration-200"
            >
              {it.label}
            </a>
          ))}
          <a
            href="#contact"
            className="text-[12px] lg:text-[13px] tracking-[0.16em] uppercase font-medium px-4 py-2 rounded-full border border-[color:var(--ice-border-strong)] text-[color:var(--ice-text)] hover:bg-[color:var(--ice-surface)] transition-colors duration-200"
          >
            Contact
          </a>
        </nav>

        {/* SP: 簡素な Contact ボタンのみ。混雑回避 (ハンバーガーは MVP 後で検討) */}
        <a
          href="#contact"
          className="md:hidden text-[11px] tracking-[0.14em] uppercase font-medium px-3.5 py-1.5 rounded-full border border-[color:var(--ice-border-strong)] text-[color:var(--ice-text)]"
        >
          Contact
        </a>
      </div>
    </header>
  );
}
