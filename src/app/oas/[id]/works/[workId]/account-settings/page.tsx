// src/app/oas/[id]/works/[workId]/account-settings/page.tsx
//
// 作品配下（in-layout）で開く「アカウント設定」。中身は OA 設定ハブ（/oas/[id]/settings）を
// そのまま再利用する（= 同一 UI・同一 RBAC）。作品 layout 配下に置くことで左サイドバーを維持し、
// サイドバーの「アカウント設定」が active になる。
//   - 新規 API / DB / 権限ロジックは持たない（既存ページの再エクスポートのみ）。
//   - OA 設定ハブは useParams<{ id }> で oaId を解決するため、作品ルート（id/workId 両方あり）でも動く。
export { default } from "../../../settings/page";
