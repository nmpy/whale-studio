// src/app/oas/[id]/works/[workId]/layout.tsx
//
// 作品配下（/oas/[id]/works/[workId]/*）にだけ左サイドバーを差し込む共通レイアウト。
//   - 既存の AppHeader / パンくず / ハブカード / 各ページ本体は一切変更しない（これは付加的な shell）。
//   - 右メイン（children）はサイドバー幅ぶん右へずれるが、中身 UI は不変。
//     min-width:0 で狭幅時の横崩れを防ぐ。サイドバーは _WorkSidebar 側で狭幅時 hidden。
//   - データ取得・認証・権限・遷移ロジックは持たない（純粋なレイアウトのみ）。

import WorkSidebar from "./_WorkSidebar";

// 作品配下は情報量が多く、AppShell の `.container`(max-width:980px) ＋ 左サイドバー(232px) では
// メイン領域が狭くなる（≈680px）。そこで作品配下だけ container 上限から解放し、最大 1400px・
// 左右ガター付き・中央寄せで横幅を確保する（全作品ページに適用。CSS の幅/位置のみ＝ロジック不変）。
//   - 外側 div: `margin-inline: calc(50% - 50vw)` で .container をビューポート幅まで開放（スクロールバー安全）。
//   - 内側 div: max-width 1400 + 中央寄せ + 左右パディングで上限を付ける。
export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginInline: "calc(50% - 50vw)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "flex-start", gap: 20 }}>
        <WorkSidebar />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
