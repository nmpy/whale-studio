// src/lib/content-width.ts
// AppShell のコンテンツ最大幅の判定（ページ固有の wide レイアウト）。
//   - /oas（アカウント一覧トップ＝スタジオ全体ダッシュボード同居）だけ wide(1200px)。
//   - それ以外（/oas/new・/oas/[id]/**・/admin/**・/admin/error-log・/login 等）は既定(980px) のまま。
//   - 全ページ共通の .container は変更しない。ここで判定した wide のときだけ .container-wide を足す。

/** wide(1200px) コンテンツ幅にすべきルートか。/oas 完全一致のみ true。 */
export function isWideContentRoute(pathname: string | null | undefined): boolean {
  return pathname === "/oas";
}
