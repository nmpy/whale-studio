"use client";

// src/components/AppShell.tsx
// Root layout から取り回す Client Shell。
// pathname に応じて CMS (管理画面) と LIFF (プレイヤー) のレイアウトを切り替える。
//
// - CMS:  <AppHeader /> + <main><div className="container">{children}</div></main>
// - LIFF: ヘッダー無し / container 無し。LIFF 個別の layout (src/app/liff/layout.tsx) に任せる。
//
// 理由:
//   AppHeader は /login と /access-denied だけを除外していたため、/liff/* にも CMS ヘッダーが
//   漏れてプレイヤー体験を阻害していた。container CSS (max-width 980px / padding) も
//   モバイル前提の LIFF レイアウトと衝突するため、/liff/* では適用しない。

import { usePathname } from "next/navigation";
import AppHeader from "@/components/AppHeader";

function isLiffRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/liff" || pathname.startsWith("/liff/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const liff = isLiffRoute(pathname);

  if (liff) {
    // LIFF プレイヤー / チェックインルート: CMS ヘッダーも container も付けない。
    // 個別の layout (例: src/app/liff/layout.tsx) で必要な装飾を行う。
    return <>{children}</>;
  }

  return (
    <>
      <AppHeader />
      <main>
        <div className="container">{children}</div>
      </main>
    </>
  );
}
