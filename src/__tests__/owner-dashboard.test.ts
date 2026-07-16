// src/__tests__/owner-dashboard.test.ts
// オーナーダッシュボードの純粋ロジック（アカウント色・期間正規化）のテスト。
// 集計本体（getOwnerDashboard）は prisma 依存のため server route/認可と typecheck が担保する。
import { describe, it, expect } from "vitest";
import { accountColor } from "@/lib/owner-dashboard/account-color";
import { normalizePeriod } from "@/lib/owner-dashboard/aggregate";

describe("accountColor — 決定論的・データ非依存", () => {
  it("同じ oaId は常に同じ色", () => {
    expect(accountColor("oa-123")).toEqual(accountColor("oa-123"));
  });
  it("dot/bg/text を持ち、有効な hex", () => {
    const c = accountColor("oa-abc");
    for (const v of [c.dot, c.bg, c.text]) expect(v).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("異なる oaId は（多くの場合）異なる色になり得る＝分散する", () => {
    const colors = ["a", "b", "c", "d", "e", "f", "g"].map((id) => accountColor(id).dot);
    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});

describe("normalizePeriod — 既定 7d・不正値フォールバック", () => {
  it("有効値はそのまま", () => {
    expect(normalizePeriod("7d")).toBe("7d");
    expect(normalizePeriod("30d")).toBe("30d");
    expect(normalizePeriod("month")).toBe("month");
  });
  it("未指定/不正は 7d", () => {
    expect(normalizePeriod(undefined)).toBe("7d");
    expect(normalizePeriod("")).toBe("7d");
    expect(normalizePeriod("weird")).toBe("7d");
    expect(normalizePeriod(null)).toBe("7d");
  });
});
