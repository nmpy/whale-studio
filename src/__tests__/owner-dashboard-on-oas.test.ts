// src/__tests__/owner-dashboard-on-oas.test.ts
// スタジオ全体ダッシュボードを /oas トップへ移設した際の純粋ロジックのテスト。
//   - /admin/dashboard → /oas の redirect 先（period 維持・既定/不正値の扱い）。
//   - サーバーの platform owner 判定・横断集計の実行有無は認可 + Server Component + Preview が担保する。
import { describe, it, expect } from "vitest";
import { ownerDashboardRedirectTarget } from "@/app/admin/dashboard/redirect-target";
import { normalizePeriod } from "@/lib/owner-dashboard/aggregate";

describe("ownerDashboardRedirectTarget — /admin/dashboard → /oas（period 維持）", () => {
  it("period 指定は維持して /oas?period= へ", () => {
    expect(ownerDashboardRedirectTarget("30d")).toBe("/oas?period=30d");
    expect(ownerDashboardRedirectTarget("month")).toBe("/oas?period=month");
  });
  it("既定(7d) は period を付けない（/oas 側の既定と一致）", () => {
    expect(ownerDashboardRedirectTarget("7d")).toBe("/oas");
  });
  it("未指定・不正値は安全に既定（/oas）", () => {
    expect(ownerDashboardRedirectTarget(undefined)).toBe("/oas");
    expect(ownerDashboardRedirectTarget("")).toBe("/oas");
    expect(ownerDashboardRedirectTarget("weird")).toBe("/oas");
    expect(ownerDashboardRedirectTarget("../evil")).toBe("/oas");
  });
});

describe("normalizePeriod — /oas でも同じ period 正規化を共有", () => {
  it("有効値はそのまま・不正は 7d", () => {
    expect(normalizePeriod("7d")).toBe("7d");
    expect(normalizePeriod("30d")).toBe("30d");
    expect(normalizePeriod("month")).toBe("month");
    expect(normalizePeriod(undefined)).toBe("7d");
    expect(normalizePeriod("nope")).toBe("7d");
  });
});
