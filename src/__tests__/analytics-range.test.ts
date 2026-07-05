// src/__tests__/analytics-range.test.ts
// オーディエンス期間フィルターの parse/validate（JST）検証。
import { describe, it, expect } from "vitest";
import { parseAnalyticsRange, isWithinRange, countDailyNewPlayers, last7JstDayBuckets } from "@/lib/analytics-range";

// 基準時刻: 2026-07-04 05:00 UTC = 2026-07-04 14:00 JST（JST の暦日は 7/4）。
const NOW = new Date("2026-07-04T05:00:00.000Z");
// JST 日境界（UTC 表現）: 00:00 JST = 前日 15:00 UTC / 23:59:59.999 JST = 当日 14:59:59.999 UTC
const jstStart = (ymd: string) => new Date(`${ymd}T00:00:00.000+09:00`);
const jstEnd   = (ymd: string) => new Date(`${ymd}T23:59:59.999+09:00`);

describe("parseAnalyticsRange — プリセット（JST 基準）", () => {
  it("all / 未指定 / 不正 range → 全期間（from/to=null）", () => {
    expect(parseAnalyticsRange({ range: "all" }, NOW)).toMatchObject({ from: null, to: null, key: "all" });
    expect(parseAnalyticsRange({}, NOW)).toMatchObject({ from: null, to: null, key: "all" });
    expect(parseAnalyticsRange({ range: "bogus" }, NOW)).toMatchObject({ from: null, to: null, key: "all" });
  });

  it("today → 当日 00:00〜23:59:59.999 JST", () => {
    const r = parseAnalyticsRange({ range: "today" }, NOW);
    expect(r.key).toBe("today");
    expect(r.from!.toISOString()).toBe(jstStart("2026-07-04").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-04").toISOString());
  });

  it("yesterday → 前日 JST", () => {
    const r = parseAnalyticsRange({ range: "yesterday" }, NOW);
    expect(r.from!.toISOString()).toBe(jstStart("2026-07-03").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-03").toISOString());
  });

  it("last_7_days → 当日含む7日（6/28〜7/4 JST）", () => {
    const r = parseAnalyticsRange({ range: "last_7_days" }, NOW);
    expect(r.from!.toISOString()).toBe(jstStart("2026-06-28").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-04").toISOString());
  });

  it("last_30_days → 当日含む30日（6/5〜7/4 JST）", () => {
    const r = parseAnalyticsRange({ range: "last_30_days" }, NOW);
    expect(r.from!.toISOString()).toBe(jstStart("2026-06-05").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-04").toISOString());
  });

  it("this_month → 今月1日〜当日 JST", () => {
    const r = parseAnalyticsRange({ range: "this_month" }, NOW);
    expect(r.from!.toISOString()).toBe(jstStart("2026-07-01").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-04").toISOString());
  });
});

describe("parseAnalyticsRange — custom（from/to は JST 日付）", () => {
  it("from は 00:00:00.000 JST から、to は 23:59:59.999 JST まで含める", () => {
    const r = parseAnalyticsRange({ from: "2026-07-01", to: "2026-07-31" }, NOW);
    expect(r.key).toBe("custom");
    expect(r.from!.toISOString()).toBe(jstStart("2026-07-01").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-31").toISOString());
  });

  it("range=custom でも from/to を解釈", () => {
    const r = parseAnalyticsRange({ range: "custom", from: "2026-07-04", to: "2026-07-04" }, NOW);
    expect(r.from!.toISOString()).toBe(jstStart("2026-07-04").toISOString());
    expect(r.to!.toISOString()).toBe(jstEnd("2026-07-04").toISOString());
  });

  it("from のみ / to のみでも成立（片側無制限）", () => {
    expect(parseAnalyticsRange({ from: "2026-07-01" }, NOW)).toMatchObject({ to: null, key: "custom" });
    expect(parseAnalyticsRange({ to: "2026-07-31" }, NOW)).toMatchObject({ from: null, key: "custom" });
  });

  it("from > to → 全期間にフォールバック（クラッシュしない）", () => {
    expect(parseAnalyticsRange({ from: "2026-07-31", to: "2026-07-01" }, NOW)).toMatchObject({ from: null, to: null, key: "all" });
  });

  it("不正な日付（書式・非実在日）は無視 → 両方不正なら全期間", () => {
    expect(parseAnalyticsRange({ from: "2026/07/01", to: "xxxx" }, NOW)).toMatchObject({ from: null, to: null, key: "all" });
    expect(parseAnalyticsRange({ from: "2026-02-31", to: "2026-02-31" }, NOW)).toMatchObject({ from: null, to: null, key: "all" });
  });
});

describe("isWithinRange", () => {
  const range = { from: jstStart("2026-07-01"), to: jstEnd("2026-07-31") };
  it("期間内は true / 期間外は false", () => {
    expect(isWithinRange(new Date("2026-07-15T00:00:00+09:00"), range)).toBe(true);
    expect(isWithinRange(new Date("2026-06-30T23:59:59+09:00"), range)).toBe(false);
    expect(isWithinRange(new Date("2026-08-01T00:00:00+09:00"), range)).toBe(false);
  });
  it("境界（from の 00:00:00 / to の 23:59:59.999）は含む", () => {
    expect(isWithinRange(jstStart("2026-07-01"), range)).toBe(true);
    expect(isWithinRange(jstEnd("2026-07-31"), range)).toBe(true);
  });
  it("null 境界は無制限", () => {
    expect(isWithinRange(new Date("2000-01-01T00:00:00Z"), { from: null, to: null })).toBe(true);
  });
});

describe("last7JstDayBuckets / countDailyNewPlayers（作品トップ 直近7日棒グラフ）", () => {
  it("7日分・当日含む・古い順（JST）で日付/曜日を返す", () => {
    const b = last7JstDayBuckets(NOW); // NOW=2026-07-04 14:00 JST
    expect(b).toHaveLength(7);
    expect(b[0].date).toBe("2026-06-28"); // 6日前
    expect(b[6].date).toBe("2026-07-04"); // 当日（末尾）
    // 2026-07-04 は土曜
    expect(b[6].label).toBe("土");
  });

  it("createdAt を JST 日別に正しくカウント（境界含む・範囲外は0）", () => {
    const dates = [
      new Date("2026-07-04T00:00:00+09:00"), // 当日 開始境界
      new Date("2026-07-04T23:59:59+09:00"), // 当日 終了間際
      new Date("2026-07-01T12:00:00+09:00"), // 3日前
      new Date("2026-05-01T12:00:00+09:00"), // 範囲外（7日より前）
    ];
    const r = countDailyNewPlayers(dates, NOW);
    const byDate = Object.fromEntries(r.map((d) => [d.date, d.count]));
    expect(byDate["2026-07-04"]).toBe(2);
    expect(byDate["2026-07-01"]).toBe(1);
    // 範囲外は合計に含まれない
    expect(r.reduce((s, d) => s + d.count, 0)).toBe(3);
  });

  it("空配列でも7日分を0で返す（fake を作らない）", () => {
    const r = countDailyNewPlayers([], NOW);
    expect(r).toHaveLength(7);
    expect(r.every((d) => d.count === 0)).toBe(true);
  });
});
