// src/app/oas/[id]/_components/WorkManagementShell.tsx
//
// 作品コンテキストの共通シェル（左サイドバー + 右メイン）。
//   - 作品配下 layout（/oas/[id]/works/[workId]/layout.tsx）と、workId 付きの OA 階層現地トリガー
//     画面（/oas/[id]/locations/layout.tsx）の両方から使う。ページごとにサイドバーを複製しない。
//   - 幅/位置の CSS のみ（データ取得・認証・権限・遷移ロジックは持たない）。
//   - AppShell の `.container`(max-width:980px) を作品コンテキストだけビューポート幅まで開放し、
//     最大 1400px・左右ガター付き・中央寄せで横幅を確保する（既存 WorkLayout と同一）。
//     内側メインは min-width:0 で狭幅時の横崩れを防ぐ。サイドバーは狭幅時 hidden（WorkSidebar 側）。
//
// props:
//   - workIdOverride: OA 階層画面で searchParams 由来の workId を渡す（作品配下では省略）。
//   - activeKey: OA 階層画面で明示するアクティブキー（作品配下では省略＝pathname 判定）。

import WorkSidebar from "./WorkSidebar";

export default function WorkManagementShell({
  children,
  workIdOverride,
  activeKey,
}: {
  children: React.ReactNode;
  workIdOverride?: string;
  activeKey?: string | null;
}) {
  return (
    <div style={{ marginInline: "calc(50% - 50vw)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "flex-start", gap: 20 }}>
        <WorkSidebar workIdOverride={workIdOverride} activeKey={activeKey} />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
