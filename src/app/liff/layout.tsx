// src/app/liff/layout.tsx
// LIFF ページ用レイアウト（プレイヤー向け — AppHeader なし）

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "チェックイン",
};

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {children}
    </div>
  );
}
