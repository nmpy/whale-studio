// graph-analysis.test.ts — BFS到達・DFSループ検出・エッジバッジのテスト

import { describe, it, expect } from "vitest";
import { analyzeGraph, getAncestorPath, getEdgeBadge } from "@/app/oas/[id]/works/[workId]/scenario/_node-graph/analysis/graph-analysis";
import type { LayoutEdge } from "@/app/oas/[id]/works/[workId]/scenario/_node-graph/types";

// ── ヘルパー ────────────────────────────────────────
function makePhase(id: string, type: string = "normal") {
  return { id, phase_type: type, name: `Phase ${id}`, sort_order: 0 } as any;
}
function makeTrans(id: string, from: string, to: string, opts: { condition?: string; flag_condition?: string } = {}) {
  return { id, from_phase_id: from, to_phase_id: to, label: `t-${id}`, condition: opts.condition ?? null, flag_condition: opts.flag_condition ?? null } as any;
}

// ── analyzeGraph ────────────────────────────────────
describe("analyzeGraph", () => {
  it("marks all phases reachable from start in a linear chain", () => {
    const phases = [makePhase("s", "start"), makePhase("a"), makePhase("e", "ending")];
    const trans = [makeTrans("t1", "s", "a"), makeTrans("t2", "a", "e")];
    const result = analyzeGraph(phases, trans);
    expect(result.reachablePhaseIds.has("s")).toBe(true);
    expect(result.reachablePhaseIds.has("a")).toBe(true);
    expect(result.reachablePhaseIds.has("e")).toBe(true);
    expect(result.hasEndingReachable).toBe(true);
    expect(result.loopTransitionIds.size).toBe(0);
  });

  it("detects unreachable nodes", () => {
    const phases = [makePhase("s", "start"), makePhase("a"), makePhase("orphan")];
    const trans = [makeTrans("t1", "s", "a")];
    const result = analyzeGraph(phases, trans);
    expect(result.reachablePhaseIds.has("orphan")).toBe(false);
    expect(result.reachablePhaseIds.has("a")).toBe(true);
  });

  it("detects loops (back-edges)", () => {
    const phases = [makePhase("s", "start"), makePhase("a"), makePhase("b")];
    const trans = [
      makeTrans("t1", "s", "a"),
      makeTrans("t2", "a", "b"),
      makeTrans("t3", "b", "a"), // loop
    ];
    const result = analyzeGraph(phases, trans);
    expect(result.loopTransitionIds.has("t3")).toBe(true);
  });

  it("handles empty graph", () => {
    const result = analyzeGraph([], []);
    expect(result.reachablePhaseIds.size).toBe(0);
    expect(result.hasEndingReachable).toBe(false);
    expect(result.loopTransitionIds.size).toBe(0);
  });

  it("handles graph with no ending", () => {
    const phases = [makePhase("s", "start"), makePhase("a")];
    const trans = [makeTrans("t1", "s", "a")];
    const result = analyzeGraph(phases, trans);
    expect(result.hasEndingReachable).toBe(false);
  });

  it("handles multiple start phases", () => {
    const phases = [makePhase("s1", "start"), makePhase("s2", "start"), makePhase("a")];
    const trans = [makeTrans("t1", "s1", "a"), makeTrans("t2", "s2", "a")];
    const result = analyzeGraph(phases, trans);
    expect(result.reachablePhaseIds.has("s1")).toBe(true);
    expect(result.reachablePhaseIds.has("s2")).toBe(true);
    expect(result.reachablePhaseIds.has("a")).toBe(true);
  });
});

// ── getAncestorPath ─────────────────────────────────
describe("getAncestorPath", () => {
  it("finds path from start to target", () => {
    const trans = [makeTrans("t1", "s", "a"), makeTrans("t2", "a", "b"), makeTrans("t3", "b", "c")];
    const result = getAncestorPath("c", trans);
    expect(result.pathPhaseIds.has("c")).toBe(true);
    expect(result.pathPhaseIds.has("b")).toBe(true);
    expect(result.pathPhaseIds.has("a")).toBe(true);
    expect(result.pathPhaseIds.has("s")).toBe(true);
    expect(result.pathTransitionIds.has("t3")).toBe(true);
    expect(result.pathTransitionIds.has("t2")).toBe(true);
    expect(result.pathTransitionIds.has("t1")).toBe(true);
  });

  it("returns only target when no incoming transitions", () => {
    const result = getAncestorPath("orphan", []);
    expect(result.pathPhaseIds.size).toBe(1);
    expect(result.pathPhaseIds.has("orphan")).toBe(true);
    expect(result.pathTransitionIds.size).toBe(0);
  });
});

// ── getEdgeBadge ────────────────────────────────────
describe("getEdgeBadge", () => {
  const baseEdge: LayoutEdge = {
    id: "e1", fromId: "a", toId: "b", label: "test", color: "#000", border: "#000",
    kind: "phase-transition", isDefault: true,
  };

  it("returns default badge for unconditioned transition", () => {
    const badge = getEdgeBadge(baseEdge);
    expect(badge.text).toBe("デフォルト");
  });

  it("returns keyword badge for conditioned transition", () => {
    const badge = getEdgeBadge({ ...baseEdge, condition: "hello" });
    expect(badge.text).toContain("hello");
  });

  it("returns correct badge for 正解 label", () => {
    const badge = getEdgeBadge({ ...baseEdge, label: "正解ルート" });
    expect(badge.text).toBe("✓ 正解");
    expect(badge.color).toBe("#15803d");
  });

  it("returns incorrect badge for 不正解 label", () => {
    const badge = getEdgeBadge({ ...baseEdge, label: "不正解" });
    expect(badge.text).toBe("✗ 不正解");
    expect(badge.color).toBe("#dc2626");
  });

  it("returns flag badge for flag condition", () => {
    const badge = getEdgeBadge({ ...baseEdge, flagCondition: "flags.score >= 10" });
    expect(badge.text).toBe("フラグ条件");
  });

  it("truncates long QR labels", () => {
    const qrEdge: LayoutEdge = { ...baseEdge, kind: "qr-phase", label: "とても長いクイックリプライラベル" };
    const badge = getEdgeBadge(qrEdge);
    expect(badge.text.endsWith("…")).toBe(true);
  });
});
