"use client";

// src/components/AppShell.tsx
// Root layout から取り回す Client Shell。
// pathname に応じて CMS (管理画面) / LIFF (プレイヤー) / 公開ブランドサイトの
// レイアウトを切り替える。
//
// - CMS:           <AppHeader /> + <main><div className="container">{children}</div></main>
// - LIFF:          ヘッダー無し / container 無し。LIFF 個別の layout (src/app/liff/layout.tsx) に任せる。
// - ブランドサイト: ヘッダー無し / container 無し。/whale/* 配下の独立ブランドページ
//                    (Whale in Ice 等) は管理画面っぽさを完全に排除する。
//                    個別の layout (src/app/whale/in-ice/layout.tsx 等) で装飾する。
//
// 理由:
//   AppHeader は /login と /access-denied だけを除外していたため、/liff/* にも CMS ヘッダーが
//   漏れてプレイヤー体験を阻害していた。container CSS (max-width 980px / padding) も
//   モバイル前提の LIFF レイアウトと衝突するため、/liff/* では適用しない。
//   /whale/* も同じ理由で SaaS の見た目から切り離す。

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { AccessPreviewBar } from "@/components/AccessPreviewBar";

function isBareLayoutRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/liff"  || pathname.startsWith("/liff/"))  return true;
  if (pathname === "/whale" || pathname.startsWith("/whale/")) return true;
  return false;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isBareLayoutRoute(pathname)) {
    // LIFF プレイヤー / 公開ブランドサイト: CMS ヘッダーも container も付けない。
    // 個別の layout (例: src/app/liff/layout.tsx, src/app/whale/in-ice/layout.tsx) で
    // 必要な装飾を行う。
    return <>{children}</>;
  }

  return (
    <>
      <AppHeader />
      {/* OA 配下 + owner のときだけ表示される独立バー (= owner 以外には何も描画されない)。
          ヘッダー横並びを崩さないため main の外、ヘッダー直下に配置する。
          AccessPreviewBar は useSearchParams を使うため、静的生成ページの CSR bailout を
          避けるべく Suspense 境界で包む (= 全ページ root layout に乗るため必須)。 */}
      <Suspense fallback={null}>
        <AccessPreviewBar />
      </Suspense>
      <main>
        <div className="container">{children}</div>
      </main>
    </>
  );
}
