// src/app/admin/_components/adminNavItems.ts
//
// スタジオ管理（/admin）のナビゲーション項目の**唯一の定義**。
// FV（/admin トップのカード一覧）と 左サイドバー（AdminSidebar）の両方がこの配列から描画する。
// → 項目追加・削除・並び替え・文言・遷移先・表示条件はここだけを編集すれば両方に反映される
//   （片方だけ更新漏れを防ぐ）。
//
// 表示条件:
//   - /admin 自体は platform admin **または** workspace owner が入れる（admin/layout.tsx）。
//   - platformOnly=true の項目は platform admin のみに表示する（= 各ページ側の server gate と一致）。
//     これにより、ページを開けないユーザーにナビ項目（デッドリンク）を見せない。
//
// 注:
//   - desc / color は FV カード用の表示メタ（サイドバーは label のみ使用）。一致対象は
//     項目・順序・label・href・表示条件であり、これらは両者で同一になる。
//   - /admin/privacy-acceptances・/admin/documents は別ページへの redirect エイリアスのため
//     ナビ項目には含めない（実体ページではない）。

export type AdminNavItem = {
  /** 遷移先 URL */
  href: string;
  /** 表示名称（FV カード見出し / サイドバーリンクで共通） */
  label: string;
  /** FV カードの補足説明（サイドバーでは未使用） */
  desc: string;
  /** FV カードのアクセントカラー（サイドバーでは未使用） */
  color: string;
  /** true = platform admin のみ表示（各ページの server gate と一致させる） */
  platformOnly: boolean;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  // ── プラットフォームオーナー横断（platform admin のみ）──
  { href: "/admin/dashboard", label: "スタジオ全体ダッシュボード", desc: "全アカウント横断の状況・プレイヤー・失敗率を俯瞰", color: "#178a48", platformOnly: true },
  { href: "/admin/error-log", label: "エラーログ", desc: "全アカウント横断の失敗ログを確認・解決 / 再オープン", color: "#c2564d", platformOnly: true },
  // ── 全管理ユーザー（platform admin / workspace owner）に表示 ──
  { href: "/admin/oa-onboarding",  label: "OA連携審査",        desc: "新規ユーザーの LINE 公式アカウント連携申請を承認 / 差し戻し", color: "#06C755", platformOnly: false },
  { href: "/admin/studio-invites", label: "招待URL発行",       desc: "利用区分・プラン権限・ロールを指定して招待URLを発行（有効期限7日）",   color: "#0d9488", platformOnly: false },
  { href: "/admin/announcements", label: "お知らせ管理",      desc: "ユーザーへのお知らせの作成・公開・非公開を管理",            color: "#2563eb", platformOnly: false },
  { href: "/admin/audience",      label: "ユーザー概況",      desc: "登録ユーザーの概況・推移を確認",                          color: "#0ea5e9", platformOnly: false },
  { href: "/admin/onboarding",    label: "オンボーディング分析", desc: "オンボーディングの進捗・離脱を分析",                     color: "#14b8a6", platformOnly: false },
  { href: "/admin/billing",       label: "課金導線分析",      desc: "課金導線イベントの分析・確認",                            color: "#d97706", platformOnly: false },
  { href: "/admin/hub-actions",   label: "ハブ操作分析",      desc: "ハブ画面の操作イベントを分析",                            color: "#8b5cf6", platformOnly: false },
  { href: "/admin/resume",        label: "再開分析",          desc: "再開導線の利用状況を分析",                                color: "#ec4899", platformOnly: false },
  { href: "/admin/audit",         label: "操作ログ",          desc: "管理操作の履歴を確認",                                    color: "#059669", platformOnly: false },
  { href: "/admin/api",           label: "API連携",           desc: "外部システムから作品・フェーズ情報を参照するためのAPI仕様を確認します", color: "#4f46e5", platformOnly: false },

  // ── platform admin 専用（運営） ──
  { href: "/admin/policies",                  label: "規約管理",            desc: "利用規約・プライバシーポリシーの編集と同意履歴を管理",   color: "#7c3aed", platformOnly: true },
  { href: "/admin/live",                      label: "Whale Studio Live 管理", desc: "OA ごとに Whale Studio Live（上位機能）の有効 / 無効を切り替え", color: "#0284c7", platformOnly: true },
  { href: "/admin/users",                     label: "ユーザー",            desc: "Whale Studio に登録したユーザーの一覧・検索",            color: "#3b82f6", platformOnly: true },
  { href: "/admin/personal-plan-permissions", label: "個人プラン権限",      desc: "個人プランの権限を OA ごとに設定",                        color: "#f59e0b", platformOnly: true },
  { href: "/admin/business-invite-links",     label: "法人プラン権限",      desc: "法人向け招待リンクの発行・管理",                          color: "#db2777", platformOnly: true },
] as const;

/** isPlatform に応じて表示すべきナビ項目を返す（FV・サイドバー共通の表示条件）。 */
export function visibleAdminNavItems(isPlatform: boolean): readonly AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => isPlatform || !item.platformOnly);
}
