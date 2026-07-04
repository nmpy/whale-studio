// src/app/oas/[id]/works/[workId]/_work-sidebar-nav.ts
// 作品配下 左サイドバーのナビ構成（純関数・表示コンポーネントから分離してテスト可能に）。
//   - 主要機能: フェーズ / キャラクター / メッセージ / LIFF / オーディエンス / ロケーション
//   - 設定    : 作品設定（旧「作品情報」・href 不変） / アカウント設定（tester 非表示）
//   - その他  : X投稿 / 利用プラン
// アカウント設定 / 利用プランは **作品配下（in-layout）ルート**に向ける（= 遷移後もサイドバーを維持）。
//   - アカウント設定 → `${base}/account-settings`（中身は OA 設定ハブを再利用）
//   - 利用プラン     → `${base}/pricing`（中身は /pricing を再利用・usageType は OA から解決）
// 新規 API / DB / 権限ロジックは無し。

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
        // OA 設定ハブを作品配下（in-layout）で開く（= サイドバー維持）。tester は非表示（従来の設定ボタンと同条件）。
        ...(!isTester ? [{ label: "アカウント設定", href: `${base}/account-settings`, activeSegments: ["/account-settings"] } as SidebarItem] : []),
      ],
    },
    {
      heading: "その他",
      items: [
        { label: "X投稿", href: `${base}/x-posts`, activeSegments: ["/x-posts"] },
        // 料金プランを作品配下（in-layout）で開く（= サイドバー維持）。全ロール表示（従来のプランボタンと同条件）。
        { label: "利用プラン", href: `${base}/pricing`, activeSegments: ["/pricing"] },
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
