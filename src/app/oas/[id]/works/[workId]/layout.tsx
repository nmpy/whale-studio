// src/app/oas/[id]/works/[workId]/layout.tsx
//
// 作品配下（/oas/[id]/works/[workId]/*）にだけ左サイドバーを差し込む共通レイアウト。
//   - 既存の AppHeader / パンくず / ハブカード / 各ページ本体は一切変更しない（これは付加的な shell）。
//   - 右メイン（children）はサイドバー幅ぶん右へずれるが、中身 UI は不変。
//     min-width:0 で狭幅時の横崩れを防ぐ。サイドバーは _WorkSidebar 側で狭幅時 hidden。
//   - データ取得・認証・権限・遷移ロジックは持たない（純粋なレイアウトのみ）。

import WorkSidebar from "./_WorkSidebar";

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
      <WorkSidebar />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
