// src/app/admin/dashboard/page.tsx
// スタジオ全体ダッシュボードは /oas トップ（アカウント一覧の上部）へ移設した。
// このルートは旧 URL / ブックマーク互換のため /oas へ redirect するだけ（period は維持）。
//   - /admin 配下は admin/layout.tsx が platform / workspace owner に限定済み（通常ユーザーは既に /oas へ弾かれる）。
//     ここでは追加のデータ取得をせず、認可済みユーザーを即 /oas へ送る（横断集計は /oas 側で platform owner のみ実行）。

import { redirect } from "next/navigation";
import { ownerDashboardRedirectTarget } from "./redirect-target";

export const dynamic = "force-dynamic";

export default function OwnerDashboardRedirectPage({ searchParams }: { searchParams?: { period?: string } }) {
  redirect(ownerDashboardRedirectTarget(searchParams?.period));
}
