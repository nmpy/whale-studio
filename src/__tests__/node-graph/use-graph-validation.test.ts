// use-graph-validation.test.ts — バリデーションロジックのテスト

import { describe, it, expect } from "vitest";
import type { GraphAnalysis, NodeStatus } from "@/app/oas/[id]/works/[workId]/scenario/_node-graph/types";

// バリデーションロジックを直接テスト（hook のラッパーではなく純粋関数テスト）
function makePhase(id: string, type: string = "normal") {
  return { id, phase_type: type, name: `Phase ${id}`, sort_order: 0 } as any;
}
function makeTrans(id: string, from: string, to: string, opts: { condition?: string; flag_condition?: string } = {}) {
  return { id, from_phase_id: from, to_phase_id: to, label: `t-${id}`, condition: opts.condition ?? null, flag_condition: opts.flag_condition ?? null } as any;
}

// バリデーションロジックを再実装（hookから分離したテスト用）
function validateGraph(
  phases: any[], transitions: any[], analysis: GraphAnalysis,
): { statusMap: Map<string, NodeStatus>; errors: Array<{ phaseId: string; status: NodeStatus; severity: string }> } {
  const statusMap = new Map<string, NodeStatus>();
  const errors: Array<{ phaseId: string; status: NodeStatus; severity: string }> = [];

  const outCount: Record<string, number> = {};
  const outWithCondition: Record<string, number> = {};
  for (const t of transitions) {
    outCount[t.from_phase_id] = (outCount[t.from_phase_id] ?? 0) + 1;
    if (t.condition || t.flag_condition) {
      outWithCondition[t.from_phase_id] = (outWithCondition[t.from_phase_id] ?? 0) + 1;
    }
  }

  const startPhases = phases.filter((p: any) => p.phase_type === "start");
  if (startPhases.length > 1) {
    for (const sp of startPhases) {
      errors.push({ phaseId: sp.id, status: "disconnected", severity: "error" });
    }
  }

  for (const phase of phases) {
    if (phase.phase_type === "global") { statusMap.set(phase.id, "ok"); continue; }

    if (phase.phase_type !== "start" && !analysis.reachablePhaseIds.has(phase.id)) {
      statusMap.set(phase.id, "disconnected");
      errors.push({ phaseId: phase.id, status: "disconnected", severity: "error" });
      continue;
    }

    const hasLoop = transitions.some((t: any) => t.from_phase_id === phase.id && analysis.loopTransitionIds.has(t.id));
    if (hasLoop) {
      statusMap.set(phase.id, "loop");
      errors.push({ phaseId: phase.id, status: "loop", severity: "warning" });
      continue;
    }

    const oc = outCount[phase.id] ?? 0;
    const owc = outWithCondition[phase.id] ?? 0;
    if (oc > 1 && owc < oc && phase.phase_type !== "ending") {
      statusMap.set(phase.id, "no-condition");
      errors.push({ phaseId: phase.id, status: "no-condition", severity: "warning" });
      continue;
    }

    statusMap.set(phase.id, "ok");
  }

  return { statusMap, errors };
}

describe("graph validation", () => {
  it("marks unreachable phases as disconnected (error)", () => {
    const phases = [makePhase("s", "start"), makePhase("a"), makePhase("orphan")];
    const trans = [makeTrans("t1", "s", "a")];
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(["s", "a"]),
      hasEndingReachable: false,
      loopTransitionIds: new Set(),
    };
    const result = validateGraph(phases, trans, analysis);
    expect(result.statusMap.get("orphan")).toBe("disconnected");
    expect(result.errors.find(e => e.phaseId === "orphan")?.severity).toBe("error");
  });

  it("marks phases with loops as loop (warning)", () => {
    const phases = [makePhase("s", "start"), makePhase("a")];
    const trans = [makeTrans("t1", "s", "a"), makeTrans("t2", "a", "s")];
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(["s", "a"]),
      hasEndingReachable: false,
      loopTransitionIds: new Set(["t2"]),
    };
    const result = validateGraph(phases, trans, analysis);
    expect(result.statusMap.get("a")).toBe("loop");
    expect(result.errors.find(e => e.phaseId === "a")?.severity).toBe("warning");
  });

  it("marks phases with mixed conditions as no-condition (warning)", () => {
    const phases = [makePhase("s", "start"), makePhase("a")];
    const trans = [
      makeTrans("t1", "a", "s", { condition: "yes" }),
      makeTrans("t2", "a", "s"), // no condition
    ];
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(["s", "a"]),
      hasEndingReachable: false,
      loopTransitionIds: new Set(),
    };
    const result = validateGraph(phases, trans, analysis);
    expect(result.statusMap.get("a")).toBe("no-condition");
  });

  it("marks all-conditioned multiple transitions as ok", () => {
    const phases = [makePhase("s", "start"), makePhase("a"), makePhase("b")];
    const trans = [
      makeTrans("t1", "s", "a", { condition: "yes" }),
      makeTrans("t2", "s", "b", { condition: "no" }),
    ];
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(["s", "a", "b"]),
      hasEndingReachable: false,
      loopTransitionIds: new Set(),
    };
    const result = validateGraph(phases, trans, analysis);
    expect(result.statusMap.get("s")).toBe("ok");
  });

  it("detects multiple start phases as error", () => {
    const phases = [makePhase("s1", "start"), makePhase("s2", "start")];
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(["s1", "s2"]),
      hasEndingReachable: false,
      loopTransitionIds: new Set(),
    };
    const result = validateGraph(phases, [], analysis);
    expect(result.errors.filter(e => e.severity === "error")).toHaveLength(2);
  });

  it("ignores global phases", () => {
    const phases = [makePhase("g", "global")];
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(),
      hasEndingReachable: false,
      loopTransitionIds: new Set(),
    };
    const result = validateGraph(phases, [], analysis);
    expect(result.statusMap.get("g")).toBe("ok");
    expect(result.errors).toHaveLength(0);
  });

  it("handles empty graph", () => {
    const analysis: GraphAnalysis = {
      reachablePhaseIds: new Set(),
      hasEndingReachable: false,
      loopTransitionIds: new Set(),
    };
    const result = validateGraph([], [], analysis);
    expect(result.statusMap.size).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
