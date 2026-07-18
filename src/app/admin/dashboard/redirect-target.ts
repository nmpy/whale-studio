// src/app/admin/dashboard/redirect-target.ts
// /admin/dashboard → /oas の遷移先を組み立てる純関数（テスト可能）。
// スタジオ全体ダッシュボードは /oas トップへ移設したが、旧 URL / ブックマークを壊さないよう redirect する。
//   - 認可は移設前の /admin/dashboard と同一に維持する（/admin/layout だけに依存しない）:
//       未認証            → /login?next=/admin/dashboard
//       非 platform owner → /admin/announcements（移設前と同じ拒否先）
//       platform owner    → /oas（period 維持）
//   - 集計（getOwnerDashboard 等）は redirect 前に一切実行しない。

import { normalizePeriod } from "@/lib/owner-dashboard/aggregate";

/** 移設前の /admin/dashboard が非 platform owner に使っていた拒否先。 */
export const ADMIN_DASHBOARD_LOGIN_DEST = "/login?next=/admin/dashboard";
export const ADMIN_DASHBOARD_NON_OWNER_DEST = "/admin/announcements";

/** period を維持した /oas への遷移先。既定(7d)や不正値は period を付けない（/oas 側の既定に一致）。 */
export function ownerDashboardRedirectTarget(rawPeriod: string | undefined): string {
  const period = normalizePeriod(rawPeriod);
  return period === "7d" ? "/oas" : `/oas?period=${period}`;
}

/**
 * /admin/dashboard の遷移先を認可込みで解決する純関数。
 * 移設前の page.tsx（getServerUser → !user は /login、!isPlatformOwner は /admin/announcements）と同一の認可を維持する。
 */
export function resolveAdminDashboardDestination(args: {
  hasUser: boolean;
  isPlatformOwner: boolean;
  rawPeriod: string | undefined;
}): string {
  if (!args.hasUser) return ADMIN_DASHBOARD_LOGIN_DEST;
  if (!args.isPlatformOwner) return ADMIN_DASHBOARD_NON_OWNER_DEST;
  return ownerDashboardRedirectTarget(args.rawPeriod);
}
