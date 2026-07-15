"use client";

// src/app/oas/[id]/_components/WorkShellBoundary.tsx
//
// /oas/[id] 配下すべてを包む client 境界。作品コンテキスト（pathname の /works/[workId] または
// query の ?workId=）が取れる管理画面でだけ、共通サイドバー（WorkManagementShell）を差し込む。
//   - route ごとに layout を足さず 1 か所で判定する（候補A）。作品コンテキスト付きページを追加しても
//     ここを通るため、サイドバー適用漏れが起きない。
//   - server layout（/oas/[id]/layout.tsx）から children を受け取り、判定して包むだけ。
//     children は Server Component のまま渡ってくる（この境界は presentation のみ。
//     データ取得・認証・認可・オンボーディングは親 layout と各ページの既存実装が担保する）。
//   - workId はサイドバーのリンク生成にのみ使用（作品情報・権限の確定には使わない）。
//   - 印刷（/locations/print）や workId 無し画面は素通し（サイドバーなし）。

import { usePathname, useSearchParams } from "next/navigation";
import WorkManagementShell from "./WorkManagementShell";
import { resolveWorkShell } from "../_lib/work-context";

export default function WorkShellBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const queryWorkId = useSearchParams().get("workId");
  const { show, workId, activeKey } = resolveWorkShell({ pathname, queryWorkId });

  if (!show || !workId) return <>{children}</>;
  return (
    <WorkManagementShell workIdOverride={workId} activeKey={activeKey}>
      {children}
    </WorkManagementShell>
  );
}
