// src/app/admin/dashboard/page.tsx
// スタジオ全体ダッシュボードは /oas トップ（アカウント一覧の上部）へ移設した。
// このルートは旧 URL / ブックマーク互換のため redirect するだけ（横断集計は実行しない）。
//   - 認可は移設前の /admin/dashboard と同一に維持する（/admin/layout だけに依存しない）:
//       未認証 → /login?next=/admin/dashboard / 非 platform owner → /admin/announcements
//       platform owner → /oas（period 維持）
//   - 認可判定の前後を問わず横断集計サービスは呼ばない（データ取得せず即 redirect）。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { resolveAdminDashboardDestination } from "./redirect-target";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardRedirectPage({ searchParams }: { searchParams?: { period?: string } }) {
  const user = await getServerUser();
  redirect(
    resolveAdminDashboardDestination({
      hasUser: !!user,
      isPlatformOwner: !!user && isPlatformOwner(user.id),
      rawPeriod: searchParams?.period,
    }),
  );
}
