// src/__tests__/work-top-summary.test.ts
import { describe, it, expect } from "vitest";
import { computePlayerSummary } from "@/lib/work-top-summary";

describe("computePlayerSummary", () => {
  it("null/0件 → isEmpty=true・全て0", () => {
    const s = computePlayerSummary(null);
    expect(s).toEqual({ total: 0, completed: 0, inProgress: 0, incomplete: 0, isEmpty: true });
    expect(computePlayerSummary({ total: 0, completed: 0, in_progress: 0 }).isEmpty).toBe(true);
  });

  it("プレイヤーがいる → total/進行中/完了/未完了を返す", () => {
    const s = computePlayerSummary({ total: 15, completed: 3, in_progress: 12 });
    expect(s.total).toBe(15);
    expect(s.completed).toBe(3);
    expect(s.inProgress).toBe(12);
    expect(s.incomplete).toBe(12); // total - completed
    expect(s.isEmpty).toBe(false);
  });

  it("in_progress 欠落時は total - completed で補完", () => {
    const s = computePlayerSummary({ total: 10, completed: 4 });
    expect(s.inProgress).toBe(6);
    expect(s.incomplete).toBe(6);
  });

  it("負値やマイナス差分は 0 に丸める（防御）", () => {
    const s = computePlayerSummary({ total: 2, completed: 5 });
    expect(s.incomplete).toBe(0);
    expect(s.total).toBe(2);
  });
});
