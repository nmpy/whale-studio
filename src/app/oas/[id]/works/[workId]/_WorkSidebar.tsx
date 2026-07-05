"use client";

// src/app/oas/[id]/works/[workId]/_WorkSidebar.tsx
//
// 作品配下（/oas/[id]/works/[workId]/*）専用の左サイドバー。
//   - 既存導線（AppHeader / パンくず / ハブカード / 各ページ本体）はそのままに、
//     作品配下の主要機能への**付加的な**導線をまとめて見やすくするだけのコンポーネント。
//   - データ取得なし（リンクは useParams の id / workId から生成）。新規 API / DB / 権限ロジックは無し。
//   - アクティブ表示は usePathname ベース（/messages 配下 → メッセージ 等）。
//   - 権限/プランの可否は **各ページ側の既存ガード**が引き続き担保する（ここでは導線を消さない）。
//
// 注: アカウント階層リンク（アカウント情報 / リッチメニュー / メンバー管理 / 利用プラン）は本PR範囲外
//     （次PRで追加予定）。SNS は曖昧さ回避のため作品配下の x-posts（X投稿）のみ表示する。

import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { withPreviewParams } from "@/lib/access-preview";
import { buildWorkSidebarSections, isSidebarItemActive, type SidebarItem } from "./_work-sidebar-nav";

export default function WorkSidebar() {
  const params = usePathnameParams();
  const pathname = usePathname() ?? "";
  // 表示確認モード（owner 限定・?previewPlan/?previewRole）を遷移後も維持するため query を引き継ぐ。
  const searchParams = useSearchParams();
  // アカウント設定（OA 設定）の表示可否は、旧・右上「設定」ボタン（showSettings=role!=="tester"）と同条件。
  const { isTester } = useWorkspaceRole(params?.id ?? "");
  if (!params) return null;
  const { id: oaId, workId } = params;
  const base = `/oas/${oaId}/works/${workId}`;

  const sections = buildWorkSidebarSections({ oaId, workId, isTester });
  const isActive = (it: SidebarItem): boolean => isSidebarItemActive(it, pathname, base);

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
                <li key={it.label}>
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

/** useParams を型安全に取り出す（id / workId が揃わなければ null）。 */
function usePathnameParams(): { id: string; workId: string } | null {
  const p = useParams<{ id?: string; workId?: string }>();
  if (!p?.id || !p?.workId) return null;
  return { id: p.id, workId: p.workId };
}
