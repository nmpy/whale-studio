// src/lib/analytics-range.ts
//
// オーディエンス分析の「表示期間フィルター」の parse / validate（JST 前提・純関数）。
//   - プリセット: today / yesterday / last_7_days / last_30_days / this_month / all / custom
//   - custom: from / to（YYYY-MM-DD）を JST の日付として解釈する
//   - from はその日の 00:00:00.000（JST）から、to はその日の 23:59:59.999（JST）まで含める
//   - タイムゾーンは Asia/Tokyo 固定（サーバは UTC 稼働のため +09:00 で日境界を算出）
//   - 不正値は安全にフォールバック（既定 = all = 全期間 / from>to も all）
//
// 返す from/to は「UTC の Date（＝比較用の絶対時刻）」。null は無制限（下限/上限なし）。

export const RANGE_KEYS = [
  "today", "yesterday", "last_7_days", "last_30_days", "this_month", "all", "custom",
] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export interface DateRange {
  from: Date | null;   // 下限（この時刻以降を含む）。null = 下限なし
  to:   Date | null;   // 上限（この時刻以前を含む）。null = 上限なし
  key:  RangeKey;       // 実際に適用されたプリセット（正規化後）
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC 時刻 d を JST の暦日 (y, m0-11, d) に分解する。 */
function jstParts(d: Date): { y: number; m: number; day: number } {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth(), day: j.getUTCDate() };
}

/** JST 暦日 (y,m,day) の 00:00:00.000（JST）を表す UTC Date。 */
function jstDayStart(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - JST_OFFSET_MS);
}
/** JST 暦日 (y,m,day) の 23:59:59.999（JST）を表す UTC Date。 */
function jstDayEnd(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 23, 59, 59, 999) - JST_OFFSET_MS);
}
/** JST 暦日を delta 日ずらした暦日を返す（月跨ぎも Date.UTC が正規化）。 */
function shiftJstDay(y: number, m: number, day: number, delta: number): { y: number; m: number; day: number } {
  const d = new Date(Date.UTC(y, m, day + delta));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

/** YYYY-MM-DD（JST 日付）を start/end の UTC Date に変換。書式不正は null。 */
function parseYmd(raw: string | null | undefined, edge: "start" | "end"): Date | null {
  if (!raw || !YMD_RE.test(raw)) return null;
  const [y, m, day] = raw.split("-").map((v) => parseInt(v, 10));
  const probe = new Date(Date.UTC(y, m - 1, day));
  // 実在日チェック（2026-02-31 等を弾く）
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return null;
  return edge === "start" ? jstDayStart(y, m - 1, day) : jstDayEnd(y, m - 1, day);
}

/**
 * クエリ（range / from / to）を DateRange に正規化する。
 * @param params { range?, from?, to? }
 * @param now    「現在時刻」（UTC Date）。テスト容易性のため注入する。
 */
export function parseAnalyticsRange(
  params: { range?: string | null; from?: string | null; to?: string | null },
  now: Date,
): DateRange {
  const rawKey = (params.range ?? "").toLowerCase().trim();
  const { y, m, day } = jstParts(now);

  // custom（range=custom もしくは from/to が明示されている場合）
  const hasCustom = rawKey === "custom" || params.from != null || params.to != null;
  if (hasCustom) {
    const from = parseYmd(params.from, "start");
    const to   = parseYmd(params.to, "end");
    // 両方不正 → all にフォールバック
    if (from === null && to === null) return { from: null, to: null, key: "all" };
    // from > to は不正 → all にフォールバック（安全側）
    if (from !== null && to !== null && from.getTime() > to.getTime()) {
      return { from: null, to: null, key: "all" };
    }
    return { from, to, key: "custom" };
  }

  switch (rawKey) {
    case "today":
      return { from: jstDayStart(y, m, day), to: jstDayEnd(y, m, day), key: "today" };
    case "yesterday": {
      const yd = shiftJstDay(y, m, day, -1);
      return { from: jstDayStart(yd.y, yd.m, yd.day), to: jstDayEnd(yd.y, yd.m, yd.day), key: "yesterday" };
    }
    case "last_7_days": {
      const s = shiftJstDay(y, m, day, -6); // 当日含めて7日
      return { from: jstDayStart(s.y, s.m, s.day), to: jstDayEnd(y, m, day), key: "last_7_days" };
    }
    case "last_30_days": {
      const s = shiftJstDay(y, m, day, -29); // 当日含めて30日
      return { from: jstDayStart(s.y, s.m, s.day), to: jstDayEnd(y, m, day), key: "last_30_days" };
    }
    case "this_month":
      return { from: jstDayStart(y, m, 1), to: jstDayEnd(y, m, day), key: "this_month" };
    case "all":
    case "":
    default:
      // 未指定 / 不正な range は全期間（既定 = 現行の見え方を壊さない）
      return { from: null, to: null, key: "all" };
  }
}

/** 時刻 t が range に含まれるか（from/to は inclusive・null は無制限）。 */
export function isWithinRange(t: Date, range: { from: Date | null; to: Date | null }): boolean {
  if (range.from && t.getTime() < range.from.getTime()) return false;
  if (range.to && t.getTime() > range.to.getTime()) return false;
  return true;
}
