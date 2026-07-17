// src/__tests__/owner-dashboard.test.ts
// オーナーダッシュボードの純粋ロジック（アカウント色・期間正規化）のテスト。
// 集計本体（getOwnerDashboard）は prisma 依存のため server route/認可と typecheck が担保する。
import { describe, it, expect } from "vitest";
import { accountColor } from "@/lib/owner-dashboard/account-color";
import { normalizePeriod } from "@/lib/owner-dashboard/aggregate";
import { mergeOwnerActivity, type OwnerActivityItem } from "@/lib/owner-dashboard/activity";
import { liffEventToActivity } from "@/lib/activity-feed";

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

describe("mergeOwnerActivity — 横断アクティビティの新しい順マージ・最新8件", () => {
  const mk = (id: string, iso: string, over: Partial<OwnerActivityItem> = {}): OwnerActivityItem => ({
    id, occurredAt: iso, oaId: over.oaId ?? "oa1", accountName: over.accountName ?? "Acc", player: over.player ?? "プレイヤー #A1B2C3", type: over.type ?? "view", title: over.title ?? "t", detail: over.detail ?? null,
  });
  it("新しい順に並べ、最新8件のみ返す", () => {
    const items = Array.from({ length: 12 }, (_, i) => mk(`e${i}`, `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    const out = mergeOwnerActivity(items, 8);
    expect(out).toHaveLength(8);
    expect(out[0].id).toBe("e11"); // 最新
    expect(Date.parse(out[0].occurredAt)).toBeGreaterThan(Date.parse(out[7].occurredAt));
  });
  it("同時刻は id で安定した順序", () => {
    const items = [mk("z", "2026-07-01T00:00:00Z"), mk("a", "2026-07-01T00:00:00Z")];
    expect(mergeOwnerActivity(items, 8).map((i) => i.id)).toEqual(["a", "z"]);
  });
  it("0件は空配列（空状態はUI側で表示）", () => {
    expect(mergeOwnerActivity([], 8)).toEqual([]);
  });
  it("View Model のみで内部 DB モデル（work/oa relation 等）を含まない", () => {
    const item = mk("x", "2026-07-01T00:00:00Z");
    expect(Object.keys(item).sort()).toEqual(["accountName", "detail", "id", "oaId", "occurredAt", "player", "title", "type"]);
  });
});

describe("横断アクティビティのイベント正規化（既存 activity-feed 流用）", () => {
  it("未対応/技術イベントはフィードに載せない（null）", () => {
    expect(liffEventToActivity("liff_init_success")).toBeNull();
  });
  it("既知イベントは kind/detail へ変換", () => {
    expect(liffEventToActivity("page_view")?.kind).toBe("view");
  });
});
