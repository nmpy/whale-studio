// _node-graph/constants.ts — サイズ・カラー定数

import type { PhaseType } from "@/types";

// ── ノードサイズ（React Flow用に拡大） ───────────────
export const PHASE_W    = 280;
export const PHASE_H    = 100;
export const MSG_W      = 240;
export const MSG_H      = 62;
export const COL_W      = 420;
export const MSG_INDENT = 14;
export const MSG_Y_GAP  = 10;
export const MSG_V_GAP  = 6;
export const GROUP_GAP  = 44;
export const CANVAS_PAD = 50;

// ── フェーズ別カラー ────────────────────────────────
export const PHASE_META: Record<PhaseType, { label: string; color: string; bg: string; border: string }> = {
  start:  { label: "開始",           color: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0" },
  normal: { label: "通常",           color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
  ending: { label: "エンディング",   color: "#ef4444", bg: "#fff1f2", border: "#fecaca" },
  global: { label: "全フェーズ共通", color: "#b45309", bg: "#fffbeb", border: "#fcd34d" },
};

// ── メッセージ種別カラー ────────────────────────────
export const MSG_KIND_META: Record<string, { label: string; color: string; border: string }> = {
  start:    { label: "開始",   color: "#22c55e", border: "#bbf7d0" },
  normal:   { label: "通常",   color: "#3b82f6", border: "#bfdbfe" },
  response: { label: "応答",   color: "#7c3aed", border: "#e9d5ff" },
  hint:     { label: "ヒント", color: "#d97706", border: "#fde68a" },
  puzzle:   { label: "謎",     color: "#ef4444", border: "#fecaca" },
};
