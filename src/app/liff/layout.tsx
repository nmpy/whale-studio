// src/app/liff/layout.tsx
// LIFF ページ用レイアウト（プレイヤー向け — AppHeader なし）
// プレイヤー画面のフォントを LINE Seed JP に統一する。
// 重量は本文用 400 と見出し・ボタン用 700 のみ読み込み、
// font-display: swap でブロッキングを避ける（fontsource 既定）。

import type { Metadata } from "next";
import "@fontsource/line-seed-jp/400.css";
import "@fontsource/line-seed-jp/700.css";
import "./liff-font.css";

export const metadata: Metadata = {
  title: "チェックイン",
};

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    // 背景・タイポグラフィは liff-font.css で定義された LIFF デザイントークンに従う。
    // 個別のページ（プレイヤー / ヒントサイト）が必要に応じて bg を上書きする。
    <div className="liff-font min-h-screen bg-[color:var(--liff-background)]">
      {children}
    </div>
  );
}
