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

    for (const phase of phases) {
      // global フェーズはスキップ
      if (phase.phase_type === "global") {
        statusMap.set(phase.id, "ok");
        continue;
      }

      // 1. 到達不能チェック
      if (phase.phase_type !== "start" && !analysis.reachablePhaseIds.has(phase.id)) {
        statusMap.set(phase.id, "disconnected");
        errors.push({
          phaseId: phase.id,
          phaseName: phase.name,
          status: "disconnected",
          message: `「${phase.name}」はスタートから到達できません`,
        });
        continue;
      }

      // 2. ループチェック（outgoing にループ遷移がある）
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
        });
        continue;
      }

      // 3. 条件未設定チェック（複数 outgoing かつ全て条件なし）
      const oc = outCount[phase.id] ?? 0;
      const owc = outWithCondition[phase.id] ?? 0;
      if (oc > 1 && owc === 0 && phase.phase_type !== "ending") {
        statusMap.set(phase.id, "no-condition");
        errors.push({
          phaseId: phase.id,
          phaseName: phase.name,
          status: "no-condition",
          message: `「${phase.name}」に複数遷移がありますが条件が未設定です`,
        });
        continue;
      }

      statusMap.set(phase.id, "ok");
    }

    return { statusMap, errors };
  }, [phases, transitions, analysis]);
}
