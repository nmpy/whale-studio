// src/lib/owner-error-log/period.ts
// エラーログ期間フィルタの JST 日境界（UTC 絶対時刻を返す）。Asia/Tokyo 基準。

import type { OwnerErrorLogPeriod } from "./types";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** period の開始時刻（UTC）。"all" は null（下限なし）。今日を含む。 */
export function periodStartUTC(period: OwnerErrorLogPeriod, now: Date): Date | null {
  if (period === "all") return null;
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  if (period === "month") {
    return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - JST_OFFSET_MS);
  }
  const days = period === "30d" ? 29 : 6; // 7d は今日含め7日
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() - days) - JST_OFFSET_MS);
}
