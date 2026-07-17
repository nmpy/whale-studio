// src/lib/owner-error-log/filters.ts
// URL クエリ → フィルタの正規化（純関数・テスト可能）。不正値は安全な既定へ。

import type {
  OwnerErrorLogFilters, OwnerErrorLogPeriod, OwnerErrorLogStatusFilter, OwnerErrorLogType,
} from "./types";

const STATUSES: OwnerErrorLogStatusFilter[] = ["all", "unresolved", "resolved"];
const PERIODS: OwnerErrorLogPeriod[] = ["7d", "30d", "month", "all"];
const TYPES: OwnerErrorLogType[] = ["beacon", "checkin", "message"];

/** 状態（既定 unresolved）。 */
export function normalizeStatus(v: unknown): OwnerErrorLogStatusFilter {
  return typeof v === "string" && (STATUSES as string[]).includes(v) ? (v as OwnerErrorLogStatusFilter) : "unresolved";
}

/** 期間（既定 7d）。 */
export function normalizePeriod(v: unknown): OwnerErrorLogPeriod {
  return typeof v === "string" && (PERIODS as string[]).includes(v) ? (v as OwnerErrorLogPeriod) : "7d";
}

/** 種別（既定 all）。 */
export function normalizeType(v: unknown): "all" | OwnerErrorLogType {
  if (v === "all") return "all";
  return typeof v === "string" && (TYPES as string[]).includes(v) ? (v as OwnerErrorLogType) : "all";
}

/** ページ（1 始まり・不正値は 1）。 */
export function normalizePage(v: unknown): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * searchParams からフィルタを構築。oa は実在アカウントのみ採用（不正・他値は all=null）。
 */
export function parseFilters(
  sp: Record<string, string | string[] | undefined>,
  validOaIds: Set<string>,
): OwnerErrorLogFilters {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const oaRaw = get("oa");
  const oaId = oaRaw && validOaIds.has(oaRaw) ? oaRaw : null;
  return {
    status: normalizeStatus(get("status")),
    oaId,
    type: normalizeType(get("type")),
    period: normalizePeriod(get("period")),
    page: normalizePage(get("page")),
  };
}
