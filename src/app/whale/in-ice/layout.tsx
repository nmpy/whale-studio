// src/app/whale/in-ice/layout.tsx
//
// 「Whale in Ice / 氷のくじら」ブランドサイト専用 layout。
//
// 設計方針:
//   - Whale Studio (SaaS) の管理画面とは完全に切り離した世界観
//   - 見出しに Noto Serif JP を使い「物語感」を出す。本文は Noto Sans JP (root layout で既に読込済)
//   - 配色: 深海インクブルー基調 + 氷のような薄い水色アクセント。LINE green は使わない
//   - bg / フォント / 余白の基本トークンは globals.css ではなくここでローカルに定義する
//     (= globals.css の SaaS 用トークンと衝突させない)
//   - AppShell.tsx 側で /whale/* は CMS ヘッダー / container を bypass 済み

import type { Metadata } from "next";
import { Noto_Serif_JP } from "next/font/google";

/** 見出し用セリフ。記憶に残る "物語の余韻" を出す。本文は親 layout の Noto Sans JP に任せる。 */
const notoSerifJP = Noto_Serif_JP({
  subsets: ["latin"],
  weight:  ["400", "600", "700"],
  variable: "--font-noto-serif-jp",
  display:  "swap",
});

export const metadata: Metadata = {
  title: "氷のくじら — Whale in Ice",
  description: "謎解き / マーダーミステリー / イマーシブ体験 / LINE 連動の物語体験を設計する制作レーベル。",
  openGraph: {
    title: "氷のくじら — Whale in Ice",
    description: "謎解き / マーダーミステリー / イマーシブ体験 / LINE 連動の物語体験を設計する制作レーベル。",
    siteName: "Whale in Ice",
    locale: "ja_JP",
    type: "website",
    // TODO: 本番 OG 画像が用意されたら /og-whale-in-ice.png 等に差し替え
  },
  twitter: {
    card: "summary_large_image",
    title: "氷のくじら — Whale in Ice",
    description: "物語のあとに残る体験をつくる。",
  },
};

export default function WhaleInIceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${notoSerifJP.variable} whale-in-ice-root`}>
      {/* 専用トークンは module CSS 風にここで宣言。Tailwind v4 utilities と併用しても干渉しない。
          .whale-in-ice-root に閉じこめるため、SaaS / LIFF への副作用ゼロ。 */}
      <style>{`
        .whale-in-ice-root {
          --ice-ink:           #08111E;
          --ice-deep:          #0B1A2E;
          --ice-surface:       #0F2138;
          --ice-surface-soft:  #122845;
          --ice-border:        rgba(231, 238, 245, 0.10);
          --ice-border-strong: rgba(231, 238, 245, 0.20);
          --ice-text:          #E7EEF5;
          --ice-text-muted:    #98A8BC;
          --ice-text-faint:    #5B6B82;
          --ice-accent:        #9DC8E0;    /* 氷の白水色 — controls / hover */
          --ice-accent-strong: #C7E2F2;
          --font-serif-jp:     var(--font-noto-serif-jp), 'Noto Serif JP', 'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', serif;

          background: radial-gradient(ellipse 90% 60% at 50% -10%, #15355D 0%, #0B1A2E 45%, #08111E 100%);
          color: var(--ice-text);
          min-height: 100svh;
          font-feature-settings: "palt";
          letter-spacing: 0.02em;
        }
        .whale-in-ice-root ::selection {
          background: rgba(157, 200, 224, 0.30);
          color: #FFFFFF;
        }
        .whale-in-ice-root .ice-serif {
          font-family: var(--font-serif-jp);
        }
        /* ── 控えめな fade-in (CSS-only) ─────────────────────────────────── */
        @keyframes whale-in-ice-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .whale-in-ice-root .ice-fade-up {
          animation: whale-in-ice-fade-up 1.2s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .whale-in-ice-root .ice-fade-up { animation: none; }
        }
      `}</style>
      {children}
    </div>
  );
}
