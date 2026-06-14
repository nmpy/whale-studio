// src/app/oas/[id]/works/[workId]/liff/_tabs-config.ts
//
// LIFF 管理画面の 4 タブ（ホーム / 詳細ページ / 独立ページ / 計測）の純ロジック。
// JSX を含まないため Vitest から直接 import 可。

export type LiffAdminTab = "home" | "detail" | "standalone" | "analytics";

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
    description: "「作品メニューのカードとして表示する」をオンにした、ホームに並ぶページの一覧です。",
  },
  {
    key: "standalone",
    label: "独立ページ",
    description: "ホームには出さず、QR や URL から直接開くページの一覧です。",
  },
  {
    key: "analytics",
    label: "計測",
    description: "LIFFページの閲覧数や利用状況を確認できる機能です。",
  },
];

export function isValidLiffAdminTab(value: string | null | undefined): value is LiffAdminTab {
  return value === "home" || value === "detail" || value === "standalone" || value === "analytics";
}

/** ?tab=... を読み取り、不正値は "home" にフォールバックする */
export function resolveLiffAdminTab(value: string | null | undefined): LiffAdminTab {
  return isValidLiffAdminTab(value) ? value : "home";
}
