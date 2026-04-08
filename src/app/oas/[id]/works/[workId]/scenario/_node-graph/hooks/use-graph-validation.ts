// _node-graph/hooks/use-graph-validation.ts — リアルタイムバリデーション

import { useMemo } from "react";
import type { PhaseWithCounts, TransitionWithPhases } from "@/types";
import type { NodeStatus, GraphAnalysis } from "../types";

export interface ValidationResult {
  statusMap: Map<string, NodeStatus>;
  errors: ValidationError[];
}

export interface ValidationError {
  phaseId: string;
  phaseName: string;
  status: NodeStatus;
  message: string;
  severity: "error" | "warning";
}

export function useGraphValidation(
  phases: PhaseWithCounts[],
  transitions: TransitionWithPhases[],
  analysis: GraphAnalysis,
): ValidationResult {
  return useMemo(() => {
    const statusMap = new Map<string, NodeStatus>();
    const errors: ValidationError[] = [];

    // 各フェーズの outgoing 遷移数を数える
    const outCount: Record<string, number> = {};
    const outWithCondition: Record<string, number> = {};
    for (const t of transitions) {
      outCount[t.from_phase_id] = (outCount[t.from_phase_id] ?? 0) + 1;
      if (t.condition || t.flag_condition) {
        outWithCondition[t.from_phase_id] = (outWithCondition[t.from_phase_id] ?? 0) + 1;
      }
    }

    // start フェーズが複数あるかチェック
    const startPhases = phases.filter(p => p.phase_type === "start");
    if (startPhases.length > 1) {
      for (const sp of startPhases) {
        errors.push({
          phaseId: sp.id,
          phaseName: sp.name,
          status: "disconnected",
          message: `開始フェーズが複数あります: 「${sp.name}」`,
          severity: "error",
        });
      }
    }

    for (const phase of phases) {
      // global フェーズはスキップ
      if (phase.phase_type === "global") {
        statusMap.set(phase.id, "ok");
        continue;
      }

      // 1. 到達不能チェック（最優先）
      if (phase.phase_type !== "start" && !analysis.reachablePhaseIds.has(phase.id)) {
        statusMap.set(phase.id, "disconnected");
        errors.push({
          phaseId: phase.id,
          phaseName: phase.name,
          status: "disconnected",
          message: `「${phase.name}」はスタートから到達できません`,
          severity: "error",
        });
        continue;
      }

      // 2. ループチェック
      const hasLoop = transitions.some(
        t => t.from_phase_id === phase.id && analysis.loopTransitionIds.has(t.id),
      );
      if (hasLoop) {
        statusMap.set(phase.id, "loop");
        errors.push({
          phaseId: phase.id,
          phaseName: phase.name,
          status: "loop",
          message: `「${phase.name}」にループ遷移があります`,
          severity: "warning",
        });
        continue;
      }

      // 3. 条件未設定チェック
      // 複数 outgoing があり、条件付きと条件なしが混在 → 曖昧
      const oc = outCount[phase.id] ?? 0;
      const owc = outWithCondition[phase.id] ?? 0;
      if (oc > 1 && owc < oc && phase.phase_type !== "ending") {
        statusMap.set(phase.id, "no-condition");
        errors.push({
          phaseId: phase.id,
          phaseName: phase.name,
          status: "no-condition",
          message: `「${phase.name}」に条件未設定の遷移があります（${oc - owc}/${oc}件）`,
          severity: "warning",
        });
        continue;
      }

      statusMap.set(phase.id, "ok");
    }

    // severity でソート（error が先）
    errors.sort((a, b) => {
      if (a.severity === "error" && b.severity === "warning") return -1;
      if (a.severity === "warning" && b.severity === "error") return 1;
      return 0;
    });

    return { statusMap, errors };
  }, [phases, transitions, analysis]);
}
