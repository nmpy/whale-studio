// src/app/oas/[id]/works/[workId]/layout.tsx
//
// 作品配下（/oas/[id]/works/[workId]/*）に共通の左サイドバー付きシェルを差し込む。
//   - 共通シェル（WorkManagementShell + WorkSidebar）は OA 階層（_components）に共有配置し、
//     workId 付きの現地トリガー（/oas/[id]/locations?workId=）画面とも同一実装を使う。
//   - 作品配下では workId は route params から解決されるため、shell に override を渡さない
//     （WorkSidebar が useParams で取得）。アクティブ表示は pathname ベース。
//   - 既存の AppHeader / パンくず / 各ページ本体・データ取得・認証・権限・遷移は一切変更しない（付加的な shell）。

import WorkManagementShell from "../../_components/WorkManagementShell";

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return <WorkManagementShell>{children}</WorkManagementShell>;
}
