// src/app/oas/[id]/works/[workId]/liff/_tabs-config.ts
//
// LIFF 管理画面のタブ（ホーム / 詳細ページ / 独立ページ / アンケート / よくある質問 / 計測）の純ロジック。
// JSX を含まないため Vitest から直接 import 可。

export type LiffAdminTab =
  | "home"
  | "detail"
  | "standalone"
  | "survey"
  | "faq"
  | "ticket_link"
  | "analytics";

export const LIFF_ADMIN_TABS: Array<{
  key: LiffAdminTab;
  label: string;
  description: string;
}> = [
  {
    key: "home",
    label: "ホーム",
    description: "作品メニューのホーム画面に並ぶカードの並び順・表示形式を編集し、プレビューで確認できます。",
  },
  {
    key: "detail",
    label: "詳細ページ",
    description: "「ホームに表示する」をオンにした、ホームに並ぶページの一覧です。",
  },
  {
    key: "standalone",
    label: "独立ページ",
    description: "ホームには出さず、QR や URL から直接開くページの一覧です。",
  },
  {
    key: "survey",
    label: "アンケート",
    description: "作品のアンケート（設問・送信完了メッセージ・表示/非表示）を編集できます。既存のアンケートページがあればそれを編集します。",
  },
  {
    key: "faq",
    label: "よくある質問",
    description: "作品のよくある質問（Q&A・表示順・表示/非表示）を編集できます。既存の FAQ ページがあればそれを編集します。",
  },
  {
    key: "ticket_link",
    label: "チケット連携",
    description: "予約番号とLINEアカウントを連携する機能の設定です。チケット種別・参加人数・報告ボタンを設定し、プレイヤー向けページを公開できます。",
  },
  {
    key: "analytics",
    label: "計測",
    description: "LIFFページの閲覧数や利用状況を確認できる機能です。",
  },
];

const VALID_TABS: ReadonlySet<string> = new Set(LIFF_ADMIN_TABS.map((t) => t.key));

export function isValidLiffAdminTab(value: string | null | undefined): value is LiffAdminTab {
  return value != null && VALID_TABS.has(value);
}

/** ?tab=... を読み取り、不正値は "home" にフォールバックする */
export function resolveLiffAdminTab(value: string | null | undefined): LiffAdminTab {
  return isValidLiffAdminTab(value) ? value : "home";
}

/**
 * PR-A: アンケート / よくある質問 タブが編集対象とする「指定ページ」を探す純関数。
 * 既存の survey / faq page type のページ一覧（listPages = createdAt asc）から選ぶ。
 *   - archived は除外（編集対象にしない＝保存操作で暗黙に draft/published へ戻さないため）。
 *   - 優先順位: published（の最古）→ draft（の最古）→ 該当なし / archived のみ → null。
 *   - pages が未配列 / 空 / 該当なし → null（タブ側は「作成」導線を出す）。
 *   - publish_status 未設定の既存データは archived 以外として扱う（draft 相当・安全）。
 */
export function findDesignatedLiffPage<T extends { page_type: string; publish_status?: string }>(
  pages: readonly T[] | null | undefined,
  pageType: "survey" | "faq" | "ticket_link",
): T | null {
  if (!Array.isArray(pages)) return null;
  // archived を除外した該当 page_type（配列順 = createdAt asc を維持）。
  const candidates = pages.filter(
    (p) => p != null && p.page_type === pageType && p.publish_status !== "archived",
  );
  // published を優先（最古）、無ければ最古の非 archived（= draft 等）、それも無ければ null。
  return candidates.find((p) => p.publish_status === "published") ?? candidates[0] ?? null;
}
