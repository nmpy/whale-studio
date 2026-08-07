// src/app/oas/[id]/_lib/work-sidebar-nav.ts
// 作品コンテキストの左サイドバーのナビ構成（純関数・表示コンポーネントから分離してテスト可能に）。
//   - 作品配下（/oas/[id]/works/[workId]/**）と、workId 付きの OA 階層現地トリガー画面
//     （/oas/[id]/locations?workId= / /oas/[id]/locations/beacons?workId=）の両方で共有する。
//   - 主要機能: フェーズ / キャラクター / メッセージ / LIFF / オーディエンス / ロケーション / ビーコン
//   - 設定    : 作品設定（/edit・href 不変） / アカウント設定（tester 非表示）
//   - その他  : X投稿 / 利用プラン
// 現地トリガー（ロケーション）/ ビーコンは OA 階層の canonical ルートへ向ける（実在 URL・workId 引き継ぎ）。
//   - ロケーション → /oas/[id]/locations?workId=
//   - ビーコン     → /oas/[id]/locations/beacons?workId=
// 新規 API / DB / 権限ロジックは無し。

export type SidebarItem = {
  /** 安定した識別キー（activeKey 明示指定時の一致判定に使う）。 */
  key: string;
  label: string;
  href: string;
  /** pathname がこの作品ベースからのどの相対 segment で始まればアクティブか（複数可・pathname 判定用）。 */
  activeSegments?: string[];
  /** ベース完全一致でアクティブ（作品トップ用・pathname 判定）。 */
  exact?: boolean;
  /** 作品 layout 外（OA 階層）リンク = pathname 判定ではアクティブにならない（activeKey 判定は別）。 */
  external?: boolean;
};

export type SidebarSection = { heading?: string; items: SidebarItem[] };

export function buildWorkSidebarSections(args: {
  oaId: string;
  workId: string;
  isTester: boolean;
  /** for ウズプロ を開ける（アクセス権限保有）ときのみ「FOR ウズプロ」セクションを出す。既定 false（非表示）。 */
  uzuProAccess?: boolean;
}): SidebarSection[] {
  const { oaId, workId, isTester, uzuProAccess = false } = args;
  const base = `/oas/${oaId}/works/${workId}`;
  const q = `?workId=${encodeURIComponent(workId)}`;

  return [
    {
      items: [
        { key: "top", label: "作品トップ", href: base, exact: true },
      ],
    },
    {
      heading: "主要機能",
      items: [
        { key: "phases",     label: "フェーズ",       href: `${base}/scenario`,   activeSegments: ["/scenario", "/phases"] },
        { key: "characters", label: "キャラクター",   href: `${base}/characters`, activeSegments: ["/characters"] },
        { key: "messages",   label: "メッセージ",     href: `${base}/messages`,   activeSegments: ["/messages"] },
        { key: "liff",       label: "LIFF",          href: `${base}/liff`,       activeSegments: ["/liff"] },
        { key: "audience",   label: "オーディエンス", href: `${base}/audience`,   activeSegments: ["/audience"] },
        // ロケーション（現地トリガー）は OA 階層の canonical ルート。workId を引き継いで遷移する。
        // pathname 判定では OA 階層のため external（作品 layout 外）だが、OA 階層ページでは activeKey で active になる。
        { key: "locations",  label: "ロケーション",   href: `/oas/${oaId}/locations${q}`, external: true },
        // ビーコンも OA 階層 canonical（/oas/[id]/locations/beacons）へ遷移。
        // href は OA 階層だが external にはしない: 作品配下の後方互換ルート /works/[workId]/beacons を開いた
        // ときに pathname 判定（activeSegments）で active にするため。OA 階層 locations/beacons では activeKey で判定。
        { key: "beacons",    label: "ビーコン",       href: `/oas/${oaId}/locations/beacons${q}`, activeSegments: ["/beacons"] },
      ],
    },
    {
      heading: "設定",
      items: [
        // 旧「作品情報」→ ラベルは「作品設定」（遷移先 /edit は不変）。
        { key: "edit", label: "作品設定", href: `${base}/edit`, activeSegments: ["/edit"] },
        // OA 設定ハブを作品配下（in-layout）で開く（= サイドバー維持）。tester は非表示（従来の設定ボタンと同条件）。
        ...(!isTester ? [{ key: "account-settings", label: "アカウント設定", href: `${base}/account-settings`, activeSegments: ["/account-settings"] } as SidebarItem] : []),
      ],
    },
    {
      heading: "その他",
      items: [
        { key: "x-posts", label: "X投稿", href: `${base}/x-posts`, activeSegments: ["/x-posts"] },
        // 料金プランを作品配下（in-layout）で開く（= サイドバー維持）。全ロール表示（従来のプランボタンと同条件）。
        { key: "pricing", label: "利用プラン", href: `${base}/pricing`, activeSegments: ["/pricing"] },
      ],
    },
    // for ウズプロ（隠し上位機能）。アクセス権限を持つユーザーにのみ露出する。
    // 未保有ユーザーには section ごと出さない。実際の強制は常にサーバー側ガードが担保する。
    ...(uzuProAccess
      ? [{
          heading: "FOR ウズプロ",
          items: [
            // 連携状況 = for UZU Pro のランディング。各項目は自分のパスでのみ active（相互干渉させない）。
            { key: "uzupro-status", label: "連携状況", href: `${base}/uzu-pro/status`, activeSegments: ["/uzu-pro/status"] },
            { key: "uzupro-player", label: "プレイヤー", href: `${base}/uzu-pro/player`, activeSegments: ["/uzu-pro/player"] },
            // LIFF からプレイヤーが登録した TicketLink の実データを運営が確認する read-only 画面。
            // LIFF タブ側の「チケット連携」は設定編集であり別責務。
            { key: "uzupro-ticket-links", label: "チケット連携", href: `${base}/uzu-pro/ticket-links`, activeSegments: ["/uzu-pro/ticket-links"] },
          ],
        } as SidebarSection]
      : []),
  ];
}

/**
 * サイドバー項目のアクティブ判定。
 *   - explicitActiveKey 指定時（OA 階層の locations 画面など pathname から作品ベースを判定できない場合）:
 *     item.key === explicitActiveKey で判定（external でも一致すれば active）。
 *   - 未指定時（作品配下ページ）: pathname ベース（exact / activeSegments）。external は常に非アクティブ。
 */
export function isSidebarItemActive(
  it: SidebarItem,
  pathname: string,
  base: string,
  explicitActiveKey?: string | null,
): boolean {
  if (explicitActiveKey != null) return it.key === explicitActiveKey;
  if (it.external) return false;
  if (it.exact) return pathname === it.href;
  return (it.activeSegments ?? []).some((seg) => pathname.startsWith(`${base}${seg}`));
}
