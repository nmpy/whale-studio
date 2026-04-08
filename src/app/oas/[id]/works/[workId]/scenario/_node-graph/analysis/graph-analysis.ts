// _node-graph/analysis/graph-analysis.ts — グラフ分析（BFS到達・DFSループ検出）

import type { PhaseWithCounts, TransitionWithPhases } from "@/types";
import type { GraphAnalysis, LayoutEdge } from "../types";

// ── BFS到達可能性 + DFSループ検出 ────────────────────
export function analyzeGraph(
  phases: PhaseWithCounts[],
  transitions: TransitionWithPhases[],
): GraphAnalysis {
  // 1. BFS from start phases
  const starts = phases.filter(p => p.phase_type === "start").map(p => p.id);
  const reachable = new Set<string>(starts);
  const queue = [...starts];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const t of transitions) {
      if (t.from_phase_id === id && !reachable.has(t.to_phase_id)) {
        reachable.add(t.to_phase_id);
        queue.push(t.to_phase_id);
      }
    }
  }
  const hasEndingReachable = phases
    .filter(p => p.phase_type === "ending")
    .some(p => reachable.has(p.id));

  // 2. DFS loop detection (back-edges)
  const loopTransitionIds = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adj: Record<string, Array<{ id: string; tid: string }>> = {};
  for (const t of transitions) {
    if (!adj[t.from_phase_id]) adj[t.from_phase_id] = [];
    adj[t.from_phase_id].push({ id: t.to_phase_id, tid: t.id });
  }
  function dfs(nodeId: string) {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const { id: nextId, tid } of adj[nodeId] ?? []) {
      if (!visited.has(nextId)) dfs(nextId);
      else if (inStack.has(nextId)) loopTransitionIds.add(tid);
    }
    inStack.delete(nodeId);
  }
  for (const p of phases) {
    if (!visited.has(p.id)) dfs(p.id);
  }

  return { reachablePhaseIds: reachable, hasEndingReachable, loopTransitionIds };
}

// ── 逆BFSパス検索 ───────────────────────────────────
export function getAncestorPath(
  targetPhaseId: string,
  transitions: TransitionWithPhases[],
): { pathPhaseIds: Set<string>; pathTransitionIds: Set<string> } {
  const reverse: Record<string, Array<{ fromId: string; tid: string }>> = {};
  for (const t of transitions) {
    if (!reverse[t.to_phase_id]) reverse[t.to_phase_id] = [];
    reverse[t.to_phase_id].push({ fromId: t.from_phase_id, tid: t.id });
  }
  const inPath = new Set<string>([targetPhaseId]);
  const pathTids = new Set<string>();
  const queue = [targetPhaseId];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const { fromId, tid } of reverse[id] ?? []) {
      pathTids.add(tid);
      if (!inPath.has(fromId)) {
        inPath.add(fromId);
        queue.push(fromId);
      }
    }
  }
  return { pathPhaseIds: inPath, pathTransitionIds: pathTids };
}

// ── エッジバッジ計算 ────────────────────────────────
export function getEdgeBadge(edge: LayoutEdge): {
  text: string;
  bg: string;
  color: string;
  borderColor: string;
} {
  if (edge.kind !== "phase-transition") {
    const lbl = edge.label.length > 10 ? edge.label.slice(0, 10) + "…" : edge.label;
    return { text: lbl, bg: "#f5f3ff", color: "#7c3aed", borderColor: "#ddd6fe" };
  }
  if (edge.condition) {
    const c = edge.condition.length > 8 ? edge.condition.slice(0, 8) + "…" : edge.condition;
    return { text: `🔑 ${c}`, bg: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" };
  }
  if (edge.flagCondition) {
    return { text: "フラグ条件", bg: "#f5f3ff", color: "#6d28d9", borderColor: "#e9d5ff" };
  }
  const lower = edge.label.toLowerCase();
  if (lower.includes("正解") && !lower.includes("不正解"))
    return { text: "✓ 正解", bg: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" };
  if (lower.includes("不正解"))
    return { text: "✗ 不正解", bg: "#fef2f2", color: "#dc2626", borderColor: "#fecaca" };
  return { text: "デフォルト", bg: "#f9fafb", color: "#6b7280", borderColor: "#e5e7eb" };
}
