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
import { Header } from "@/components/whale/in-ice/Header";

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
        /* ── デザイントークン (UI polish 改修) ────────────────────────────────
         * 全体を濃紺背景で統一し、白いセクション帯を排除。
         * カードは 2 段階 (--ice-surface / --ice-surface-soft) で軽くトーン差をつける。
         * 文字色は 3 段階 (見出し / 本文 / サブ) の明度差で読みやすさを担保。
         */
        .whale-in-ice-root {
          --ice-ink:           #06111F;   /* main background */
          --ice-deep:          #06111F;   /* (旧スペックで分けていたが統一) */
          --ice-surface:       #0D1E33;   /* 通常カード */
          --ice-surface-soft:  #132B46;   /* 強調カード (Contact 等) */
          --ice-border:        rgba(180, 220, 255, 0.18);
          --ice-border-strong: rgba(180, 220, 255, 0.28);
          --ice-text:          #EAF4FF;   /* 見出し */
          --ice-text-muted:    #C8D6E5;   /* 本文 */
          --ice-text-faint:    #8EA8BE;   /* サブテキスト / メタ */
          --ice-accent:        #BDE8FF;   /* アクセント (eyebrow / dots / hover) */
          --ice-accent-strong: #C8ECFA;   /* CTA 背景 */
          --font-serif-jp:     var(--font-noto-serif-jp), 'Noto Serif JP', 'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', serif;

          /* 全体は深海濃紺ベースに、aurora gradient と微細な grain を控えめに重ねる。
           * 「やりすぎると安っぽい」ので両方とも opacity を低く抑える。
           * SaaS LP 感を排除し「静かな深海の空気感」を出すための最低限の演出。 */
          background:
            radial-gradient(ellipse 80% 50% at 50% 0%,   rgba(60, 130, 200, 0.18) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 12% 95%,  rgba(40,  90, 160, 0.12) 0%, transparent 65%),
            radial-gradient(ellipse 50% 35% at 88% 70%,  rgba(80, 160, 220, 0.06) 0%, transparent 60%),
            #06111F;
          color: var(--ice-text-muted);
          min-height: 100svh;
          font-feature-settings: "palt";
          letter-spacing: 0.02em;
          position: relative;
          isolation: isolate;
        }
        /* grain — 全体に薄く乗せる。fixed で背景に紐付け、スクロールで動かない。
           opacity を 0.04 程度に抑え、SaaS 感を出さない。 */
        .whale-in-ice-root::before {
          content: "";
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: 0.04;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.8  0 0 0 0 0.9  0 0 0 0 1  0 0 0 0.7 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
        }
        /* コンテンツ自体は noise の上に来る */
        .whale-in-ice-root > * {
          position: relative;
          z-index: 1;
        }
        .whale-in-ice-root ::selection {
          background: rgba(189, 232, 255, 0.30);
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
      <div id="top" />
      <Header />
      {children}
    </div>
  );
}
