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
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { AccessPreviewBar } from "@/components/AccessPreviewBar";
import { isEditScreen } from "@/lib/is-edit-screen";

function isBareLayoutRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/liff"  || pathname.startsWith("/liff/"))  return true;
  if (pathname === "/whale" || pathname.startsWith("/whale/")) return true;
  return false;
}

/** 表示確認バーを描画すべき OA ページかどうかを path で判定する。
 *  /oas (= リスト) や /oas/new は対象外。/oas/[id] 以下のみ true。
 *  Hooks の不要 fetch + 全ページに乗る connection pool 圧迫を避けるため、
 *  non-OA path では Bar 自体を mount しない。 */
function extractOaIdForPreviewBar(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/oas\/([^/]+)/);
  if (!m) return null;
  const oaId = m[1];
  if (oaId === "new") return null;       // 新規作成ページ
  if (oaId.length < 8) return null;      // 明らかに ID 形式でない値は除外
  return oaId;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isBareLayoutRoute(pathname)) {
    // LIFF プレイヤー / 公開ブランドサイト: CMS ヘッダーも container も付けない。
    // 個別の layout (例: src/app/liff/layout.tsx, src/app/whale/in-ice/layout.tsx) で
    // 必要な装飾を行う。
    return <>{children}</>;
  }

  // 表示確認バーは OA 配下 (/oas/[id]/...) のページにだけ mount する。
  // - 非 OA ページ (/, /login, /admin, /playground, /oas, /oas/new など) では
  //   AccessPreviewBar 自体を render しない。内部 hook の不要呼び出しを完全排除し、
  //   serverless function の DB connection 消費を抑える。
  // - oaId は AppShell が決定し、Bar には props で渡す (= 重複 pathname 解析を避ける)。
  const oaId = extractOaIdForPreviewBar(pathname);

  // OA 配下かつ非編集画面では「アカウント設定」への共通導線をデフォルト表示する。
  // 編集（フォーム）画面では出さない（作業中の画面を煩雑にしないため）。
  const showAccountSettings = !!oaId && !isEditScreen(pathname);

  return (
    <>
      <AppHeader />
      {/* OA 配下・非編集画面のアカウント設定への共通導線（パンくず上の補助サブナビ）。 */}
      {showAccountSettings && (
        <div className="border-b border-line bg-bg-tint">
          <div className="container flex justify-end py-1.5">
            <Link
              href={`/oas/${oaId}/settings`}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 no-underline transition-colors hover:text-brand-ink"
            >
              <span aria-hidden="true">⚙</span> アカウント設定
            </Link>
          </div>
        </div>
      )}
      {/* OA 配下のみ owner 限定バーを mount。内部で更に owner 判定して描画する。
          useSearchParams を使うため Suspense で包む (= 静的ページ CSR bailout 防止)。 */}
      {oaId && (
        <Suspense fallback={null}>
          <AccessPreviewBar oaId={oaId} />
        </Suspense>
      )}
      <main>
        <div className="container">{children}</div>
      </main>
    </>
  );
}
