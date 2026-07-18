// src/app/admin/dashboard/redirect-target.ts
// /admin/dashboard → /oas の redirect 先を組み立てる純関数（period を維持・既定 7d は付与しない）。
// スタジオ全体ダッシュボードは /oas トップへ移設されたため、旧 URL / ブックマークを壊さないよう redirect する。

import { normalizePeriod } from "@/lib/owner-dashboard/aggregate";

/** period を維持した /oas への遷移先。既定(7d)や不正値は period を付けない（/oas 側の既定に一致）。 */
export function ownerDashboardRedirectTarget(rawPeriod: string | undefined): string {
  const period = normalizePeriod(rawPeriod);
  return period === "7d" ? "/oas" : `/oas?period=${period}`;
}
