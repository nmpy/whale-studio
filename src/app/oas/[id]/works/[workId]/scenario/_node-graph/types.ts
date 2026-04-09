// _node-graph/types.ts — ノードグラフ共通型定義

import type {
  PhaseWithCounts,
  TransitionWithPhases,
  PhaseType,
  Message,
} from "@/types";
import type { LayoutDirection } from "./layout/dagre-layout";

// ── 内部レイアウトノード ──────────────────────────────
export interface LayoutNode {
  id:        string;
  type:      "phase" | "message";
  x:         number;
  y:         number;
  width:     number;
  height:    number;
  label:     string;
  sublabel:  string;
  color:     string;
  bg:        string;
  border:    string;
  href:      string;
  phaseType?: PhaseType;
  phaseId?:  string;
}

// ── 内部レイアウトエッジ ──────────────────────────────
export interface LayoutEdge {
  id:             string;
  fromId:         string;
  toId:           string;
  label:          string;
  color:          string;
  border:         string;
  kind:           "qr-phase" | "qr-message" | "phase-transition";
  condition?:     string | null;
  flagCondition?: string | null;
  isDefault:      boolean;
  transitionId?:  string;
}

// ── グラフ分析結果 ───────────────────────────────────
export interface GraphAnalysis {
  reachablePhaseIds:  Set<string>;
  hasEndingReachable: boolean;
  loopTransitionIds:  Set<string>;
}

// ── ノードバリデーション状態 ─────────────────────────
export type NodeStatus = "ok" | "disconnected" | "no-condition" | "loop";

// ── 選択状態の型 ────────────────────────────────────
export type SelectedEntity =
  | { type: "phase"; phaseId: string; prefillTargetPhaseId?: string | null }
  | { type: "transition"; transitionId: string; fromPhaseId: string }
  | { type: "multi"; nodeIds: string[] }
  | null;

// ── NodeGraph Props ─────────────────────────────────
export interface NodeGraphProps {
  phases:        PhaseWithCounts[];
  transitions:   TransitionWithPhases[];
  allMessages:   Message[];
  oaId:          string;
  workId:        string;
  canEdit?:      boolean;
  onDataMutated: () => void;
  onValidationChange?: (result: { hasBlockingErrors: boolean; errorCount: number; warningCount: number }) => void;
}
