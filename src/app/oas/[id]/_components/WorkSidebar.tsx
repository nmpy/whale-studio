"use client";

// src/app/oas/[id]/_components/WorkSidebar.tsx
//
// 作品コンテキストの左サイドバー（作品配下ページ + workId 付き OA 階層現地トリガー画面で共有）。
//   - 既存導線（AppHeader / パンくず / 各ページ本体）はそのままに、作品配下の主要機能への
//     **付加的な**導線をまとめて見やすくするだけのコンポーネント。
//   - データ取得なし（リンクは oaId / workId から生成）。新規 API / DB / 権限ロジックは無し。
//   - workId は通常 route params（作品配下）から。OA 階層 locations 画面では `workIdOverride`（searchParams 由来）を渡す。
//   - アクティブ表示は pathname ベース。ただし pathname から作品ベースを判定できない OA 階層画面では
//     呼び出し側が `activeKey`（"locations" / "beacons" 等）を明示する。
//   - 権限/プランの可否は **各ページ側の既存ガード**が引き続き担保する（ここでは導線を消さない）。

import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { withPreviewParams } from "@/lib/access-preview";
import { buildWorkSidebarSections, isSidebarItemActive, type SidebarItem } from "../_lib/work-sidebar-nav";

export default function WorkSidebar({
  workIdOverride,
  activeKey,
}: {
  /** OA 階層（locations）画面で searchParams 由来の workId を渡す。作品配下では省略（route params を使う）。 */
  workIdOverride?: string;
  /** OA 階層画面で明示するアクティブキー（"locations" / "beacons"）。作品配下では省略（pathname 判定）。 */
  activeKey?: string | null;
}) {
  const p = useParams<{ id?: string; workId?: string }>();
  const oaId = p?.id;
  const workId = workIdOverride ?? p?.workId;
  const pathname = usePathname() ?? "";
  // 表示確認モード（owner 限定・?previewPlan/?previewRole）を遷移後も維持するため query を引き継ぐ。
  const searchParams = useSearchParams();
  // アカウント設定（OA 設定）の表示可否は、旧・右上「設定」ボタン（showSettings=role!=="tester"）と同条件。
  // for ウズプロ の可否（uzuProAccess）はサイドバー「FOR ウズプロ」の表示制御にのみ使う。
  // 実際の認可は各ページ側の既存サーバーガードが担保する（ここでは導線の出し分けのみ）。
  const { isTester, uzuProAccess } = useWorkspaceRole(oaId ?? "");
  if (!oaId || !workId) return null;
  const base = `/oas/${oaId}/works/${workId}`;

  const sections = buildWorkSidebarSections({ oaId, workId, isTester, uzuProAccess });
  const isActive = (it: SidebarItem): boolean => isSidebarItemActive(it, pathname, base, activeKey);

  return (
    <nav
      aria-label="作品メニュー"
      className="hidden lg:block"
      style={{
        flex: "0 0 232px",
        width: 232,
        alignSelf: "stretch",
        position: "sticky",
        top: 16,
        maxHeight: "calc(100vh - 32px)",
        overflowY: "auto",
        padding: "16px 12px",
        background: "var(--color-brand-soft, #e9f8ef)",
        border: "1px solid var(--color-brand-soft, #e9f8ef)",
        borderRadius: 10,
        fontSize: 14,
      }}
    >
      {sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: si === sections.length - 1 ? 0 : 14 }}>
          {sec.heading && (
            <div
              style={{
                padding: "8px 10px 4px",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-brand-ink, #0f7a3d)",
                letterSpacing: "0.02em",
              }}
            >
              {sec.heading}
            </div>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {sec.items.map((it) => {
              const active = isActive(it);
              return (
                <li key={it.key}>
                  <Link
                    href={withPreviewParams(it.href, searchParams)}
                    aria-current={active ? "page" : undefined}
                    style={{
                      display: "block",
                      padding: "8px 10px",
                      borderRadius: 6,
                      textDecoration: "none",
                      fontWeight: active ? 700 : 500,
                      color: active ? "#ffffff" : "var(--color-ink, #1f2a24)",
                      background: active ? "var(--color-brand, #22c55e)" : "transparent",
                      transition: "background 0.12s",
                    }}
                    className={active ? "" : "ws-side-link"}
                  >
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          {sec.heading !== "その他" && si < sections.length - 1 && (
            <div style={{ height: 1, background: "rgba(15,122,61,0.12)", margin: "12px 6px 0" }} />
          )}
        </div>
      ))}
      {/* hover は active 以外のみ（active は緑固定）。グローバル CSS を汚さないよう scoped style。 */}
      <style>{`.ws-side-link:hover{background:var(--color-brand-mist,#f4fbf7);}`}</style>
    </nav>
  );
}
