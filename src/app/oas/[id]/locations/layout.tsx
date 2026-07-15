"use client";

// src/app/oas/[id]/locations/layout.tsx
//
// OA 階層の現地トリガー（/oas/[id]/locations/**）を、workId 付きで作品コンテキストから開いたときにだけ
// 作品管理の共通左サイドバーで包む。
//   - Next.js の layout は searchParams を受け取れないため Client Component とし、useSearchParams で workId を読む。
//   - workId あり → 作品管理シェル（WorkManagementShell + WorkSidebar）でラップ。ビーコン配下は "beacons"、
//     それ以外の現地トリガー画面は "locations" をアクティブキーにする（両方同時に active にならない）。
//   - workId なし → 従来どおり OA 全体の現地トリガー画面（サイドバーなし）。既存の認可・絞り込みは不変。
//   - 認証・認可・プラン判定・データ取得は各ページ側の既存実装が引き続き担保する（ここでは追加しない）。
//     workId を使うのはサイドバーのリンク生成のみ（作品名・作品情報の取得はしない＝権限外情報を漏らさない）。

import { usePathname, useSearchParams } from "next/navigation";
import WorkManagementShell from "../_components/WorkManagementShell";

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  const workId = useSearchParams().get("workId");
  const pathname = usePathname() ?? "";

  // workId が無い＝OA 全体表示。従来どおりサイドバーなしで素通し（既存挙動を変えない）。
  if (!workId) return <>{children}</>;

  // ビーコン配下（/locations/beacons...）は "beacons"、それ以外の現地トリガー画面は "locations"。
  const activeKey = pathname.includes("/locations/beacons") ? "beacons" : "locations";

  return (
    <WorkManagementShell workIdOverride={workId} activeKey={activeKey}>
      {children}
    </WorkManagementShell>
  );
}
