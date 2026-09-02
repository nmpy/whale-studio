// src/app/whale/lp-v2/layout.tsx
//
// Whale Studio (SaaS) 新 LP — 確認用ルート専用 layout。
//
// 位置づけ:
//   - 公開 LP 本番は STUDIO 側 (whale-studio.app) で運用。本ルートは **Preview 確認用**。
//   - 既存トップページ (src/app/page.tsx = 認証状態による振り分け) は一切変更しない。
//   - /whale/* は AppShell.tsx で CMS ヘッダー / container を bypass 済み、
//     middleware.ts の PROTECTED_PREFIXES にも含まれないため認証不要で開ける。
//     → 新 LP を /whale/lp-v2 に置くことで、AppShell / middleware を触らずに済む。
//
// 設計方針 (in-ice に倣う):
//   - 配色 / フォント / トークンは globals.css ではなく .whale-lp-v2-root にローカル定義。
//     SaaS 管理画面・LIFF・in-ice への副作用をゼロにする。
//   - 画像アセットは持たない。装飾は CSS グラデーション + 自前 SVG のみ
//     (= 外部ライセンスの混入なし)。ブランドくじらは社内デザイン handoff の SVG を利用。
//   - in-ice が「深海ダーク + 明朝」なのに対し、こちらは SaaS プロダクト LP として
//     「白基調 + ブランドネイビー」。同居しても世界観が混ざらないよう明確に分ける。

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Whale Studio — LINEで物語体験をつくる",
  description:
    "LINE 公式アカウントと LIFF を使った物語体験を、企画から当日運用まで一気通貫で構築・運用する SaaS。シナリオフロー、キャラクター、謎、現地チェックイン、オーディエンス分析。",
  // 本ルートは確認用。STUDIO 側の本番 LP と重複インデックスされないよう明示的に noindex。
  // (root layout / robots.ts でも全体 noindex だが、意図を明示するため二重に宣言する)
  robots: { index: false, follow: false },
  openGraph: {
    title: "Whale Studio — LINEで物語体験をつくる",
    description:
      "LINE 公式アカウントと LIFF を使った物語体験を、企画から当日運用まで一気通貫で。",
    siteName: "Whale Studio",
    locale: "ja_JP",
    type: "website",
  },
};

const LP_V2_CSS = `
        .whale-lp-v2-root {
          /* ── ブランド ─────────────────────────────────────────────
             --ws-navy はデザイン handoff (WhaleLoader) で定義された Whale Studio ネイビー。 */
          --ws-navy:          #222664;
          --ws-navy-deep:     #171A4A;
          --ws-navy-soft:     #3A3F8F;
          --ws-line-green:    #06C755;   /* LINE 由来。CTA ではなく「LINE 連動」の記号としてのみ使う */

          /* ── 面 / 線 ───────────────────────────────────────────── */
          --ws-bg:            #FFFFFF;
          --ws-bg-tint:       #F6F7FB;
          --ws-surface:       #FFFFFF;
          --ws-border:        #E6E8F0;
          --ws-border-strong: #CFD3E4;

          /* ── 文字 ─────────────────────────────────────────────── */
          --ws-text:          #14162E;
          --ws-text-muted:    #5A6076;
          --ws-text-faint:    #8A90A6;

          background: var(--ws-bg);
          color: var(--ws-text);
          min-height: 100svh;
          font-feature-settings: "palt";
          letter-spacing: 0.02em;
        }
        .whale-lp-v2-root ::selection {
          background: rgba(34, 38, 100, 0.16);
          color: var(--ws-navy-deep);
        }

        /* ── 控えめな fade-in (CSS のみ) ───────────────────────────── */
        @keyframes ws-lp-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .whale-lp-v2-root .ws-fade-up {
          animation: ws-lp-fade-up 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        /* ── ヒーローのくじら: ゆっくり泳ぐ ────────────────────────── */
        @keyframes ws-lp-bob {
          0%, 100% { transform: translate(-1%, 1.5%); }
          50%      { transform: translate(1%, -2%); }
        }
        .whale-lp-v2-root .ws-whale-bob {
          animation: ws-lp-bob 6s ease-in-out infinite;
          transform-box: view-box;      /* % を viewBox 基準にする (handoff の注意書き) */
          transform-origin: 50% 50%;
        }

        /* アクセシビリティ: モーション低減設定を尊重する */
        @media (prefers-reduced-motion: reduce) {
          .whale-lp-v2-root .ws-fade-up,
          .whale-lp-v2-root .ws-whale-bob {
            animation: none;
          }
        }
`;

export default function WhaleStudioLpV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="whale-lp-v2-root">
      {/* 専用トークンをこのルート配下に閉じこめる。Tailwind v4 utilities と併用しても干渉しない。 */}
      {/* ⚠️ children ではなく dangerouslySetInnerHTML で流し込むこと。
          JSX の子要素として CSS を書くと SSR 時に " が &quot;、' が &#x27; へ
          HTML エスケープされ、クライアント側の生文字列と食い違って
          hydration mismatch になる（ページ全体がクライアント再描画に落ちる）。
          中身は自前の静的な CSS 文字列で、外部入力は一切混ざらない。 */}
      <style dangerouslySetInnerHTML={{ __html: LP_V2_CSS }} />
      {children}
    </div>
  );
}
