// src/app/oas/page.tsx
// アカウントリストのルート。
//
// ログイン後の共通入口は、アクセス可能な OA 数に関係なく必ずこのアカウントリスト（/oas）を表示する。
//   - 0 件: 空状態 / 未参加導線（OaListClient）。onboarding は layout の enforceOnboarding が担当。
//   - 1 件: アカウントリストに 1 件だけ OA カードを表示する（自動では作品一覧へ遷移しない）。
//   - 2 件以上: アカウントリストを表示する。
// OA カードのクリックで対象 OA の作品一覧へ遷移する（遷移先・権限チェックは OaListClient 側で維持）。
//
// 注: ログイン時の `next` / callbackUrl 優先挙動はログイン側（getPostAuthRedirect / next）が担うため
//     本 page には影響しない（このページは通常入口のみを担う）。
//     以前あった「アクセス可能な OA が 1 件のみのユーザーを作品一覧へ自動 redirect する」処理は撤去した
//     ＝ OA 数に関係なく必ず /oas（アカウントリスト）を表示する。

import { OaListClient } from "./_list-client";

export const dynamic = "force-dynamic";

export default function OasPage() {
  return <OaListClient />;
}
