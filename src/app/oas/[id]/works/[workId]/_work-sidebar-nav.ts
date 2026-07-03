// src/app/oas/[id]/works/[workId]/_work-sidebar-nav.ts
// 作品配下 左サイドバーのナビ構成（純関数・表示コンポーネントから分離してテスト可能に）。
//   - 主要機能: フェーズ / キャラクター / メッセージ / LIFF / オーディエンス / ロケーション
//   - 設定    : 作品設定（旧「作品情報」・href 不変） / アカウント設定（OA 設定・tester 非表示）
//   - その他  : X投稿 / 利用プラン（/pricing）
// 遷移先 URL は既存のまま（右上「プラン」「設定」ボタンの遷移先を流用）。新規 API / DB / 権限ロジックは無し。

import { buildPricingUrl } from "@/lib/pricing-url";

export type SidebarItem = {
  label: string;
  href: string;
  /** pathname がこの作品ベースからのどの相対 segment で始まればアクティブか（複数可）。 */
  activeSegments?: string[];
  /** ベース完全一致でアクティブ（作品トップ用）。 */
  exact?: boolean;
  /** 作品 layout 外（OA 階層）リンク = サイドバー内ではアクティブにならない。 */
  external?: boolean;
};

export type SidebarSection = { heading?: string; items: SidebarItem[] };

export function buildWorkSidebarSections(args: { oaId: string; workId: string; isTester: boolean }): SidebarSection[] {
  const { oaId, workId, isTester } = args;
  const base = `/oas/${oaId}/works/${workId}`;

  return [
    {
      items: [
        { label: "作品トップ", href: base, exact: true },
      ],
    },
    {
      heading: "主要機能",
      items: [
        { label: "フェーズ",       href: `${base}/scenario`,   activeSegments: ["/scenario", "/phases"] },
        { label: "キャラクター",   href: `${base}/characters`, activeSegments: ["/characters"] },
        { label: "メッセージ",     href: `${base}/messages`,   activeSegments: ["/messages"] },
        { label: "LIFF",          href: `${base}/liff`,       activeSegments: ["/liff"] },
        { label: "オーディエンス", href: `${base}/audience`,   activeSegments: ["/audience"] },
        // ロケーションは OA 階層（/oas/[id]/locations）。作品 workId を引き継いで遷移する。
        { label: "ロケーション",   href: `/oas/${oaId}/locations?workId=${workId}`, external: true },
      ],
    },
    {
      heading: "設定",
      items: [
        // 旧「作品情報」→ ラベルを「作品設定」に変更（遷移先 /edit は不変）。
        { label: "作品設定", href: `${base}/edit`, activeSegments: ["/edit"] },
        // 旧・右上「設定」ボタンの遷移先（OA 設定ハブ）。tester は非表示（showSettings と同条件）。
        ...(!isTester ? [{ label: "アカウント設定", href: `/oas/${oaId}/settings`, external: true } as SidebarItem] : []),
      ],
    },
    {
      heading: "その他",
      items: [
        { label: "X投稿", href: `${base}/x-posts`, activeSegments: ["/x-posts"] },
        // 旧・右上「プラン」ボタンの遷移先（/pricing）。全ロール表示（従来のプランボタンと同条件）。
        { label: "利用プラン", href: buildPricingUrl({ source: "work_sidebar", to: "editor", oaId }), external: true },
      ],
    },
  ];
}

/** サイドバー項目のアクティブ判定（external は常に非アクティブ）。 */
export function isSidebarItemActive(it: SidebarItem, pathname: string, base: string): boolean {
  if (it.external) return false;
  if (it.exact) return pathname === it.href;
  return (it.activeSegments ?? []).some((seg) => pathname.startsWith(`${base}${seg}`));
}
