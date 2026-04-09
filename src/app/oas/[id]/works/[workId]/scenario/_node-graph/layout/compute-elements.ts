// _node-graph/layout/compute-elements.ts
// phases/transitions/messages → React Flow Node[]/Edge[] 変換

import type { Node, Edge } from "@xyflow/react";
import type { PhaseWithCounts, TransitionWithPhases, Message } from "@/types";
import type { QuickReplyItem } from "@/types";
import type { LayoutEdge } from "../types";
import {
  PHASE_W, PHASE_H, MSG_W, MSG_H,
  COL_W, MSG_INDENT, MSG_Y_GAP, MSG_V_GAP, GROUP_GAP, CANVAS_PAD,
  PHASE_META, MSG_KIND_META,
} from "../constants";
import type { NodeStatus } from "../types";

// ── 分析情報（analytics）型 ─────────────────────────
// 将来の項目追加時はここに足すだけ。PhaseNode 側は analytics? の有無で切替。
export interface PhaseAnalytics {
  visitCount?: number;
  dropoffRate?: number;
  completionRate?: number;
  avgDurationMs?: number;
  dropoffCount?: number;
}

// ── Phase ノード data 型 ────────────────────────────
export interface PhaseNodeData {
  label: string;
  sublabel: string;
  phaseType: string;
  phaseId: string;
  color: string;
  bg: string;
  border: string;
  href: string;
  messageCount: number;
  status: NodeStatus;
  isInPath: boolean;
  analytics?: PhaseAnalytics;
  [key: string]: unknown;
}

// ── Message ノード data 型 ───────────────────────────
export interface MessageNodeData {
  label: string;
  sublabel: string;
  kind: string;
  color: string;
  bg: string;
  border: string;
  href: string;
  phaseId: string | null;
  [key: string]: unknown;
}

// ── エッジ data 型 ──────────────────────────────────
export interface ScenarioEdgeData {
  layoutEdge: LayoutEdge;
  isLoop: boolean;
  isInPath: boolean;
  [key: string]: unknown;
}

// ── メイン変換関数 ──────────────────────────────────
export function toReactFlowElements(
  phases: PhaseWithCounts[],
  transitions: TransitionWithPhases[],
  allMessages: Message[],
  oaId: string,
  workId: string,
  statusMap: Map<string, NodeStatus>,
  pathPhaseIds: Set<string>,
  pathTransitionIds: Set<string>,
  loopTransitionIds: Set<string>,
): { nodes: Node[]; edges: Edge[]; internalEdges: LayoutEdge[] } {
  // BFS depth 計算
  const out: Record<string, string[]> = {};
  transitions.forEach(t => {
    if (!out[t.from_phase_id]) out[t.from_phase_id] = [];
    out[t.from_phase_id].push(t.to_phase_id);
  });

  const depths: Record<string, number> = {};
  const starts = phases.filter(p => p.phase_type === "start").map(p => p.id);
  const queue = [...starts];
  starts.forEach(id => { depths[id] = 0; });

  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const nid of out[id] ?? []) {
      if (depths[nid] === undefined) {
        depths[nid] = (depths[id] ?? 0) + 1;
        queue.push(nid);
      }
    }
  }

  const maxD = Object.values(depths).reduce((a, b) => Math.max(a, b), 0);
  phases.forEach(p => { if (depths[p.id] === undefined) depths[p.id] = maxD + 1; });

  const byDepth: Record<number, PhaseWithCounts[]> = {};
  [...phases]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(p => {
      const d = depths[p.id] ?? 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(p);
    });

  const msgsByPhase: Record<string, Message[]> = {};
  [...allMessages]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(m => {
      if (!m.phase_id) return;
      if (!msgsByPhase[m.phase_id]) msgsByPhase[m.phase_id] = [];
      msgsByPhase[m.phase_id].push(m);
    });

  const nodes: Node[] = [];

  for (const depthStr of Object.keys(byDepth).sort((a, b) => Number(a) - Number(b))) {
    const depth = Number(depthStr);
    const baseX = CANVAS_PAD + depth * COL_W;
    let curY = CANVAS_PAD;

    for (const phase of byDepth[depth]) {
      const meta = PHASE_META[phase.phase_type] ?? PHASE_META.normal;
      const msgs = msgsByPhase[phase.id] ?? [];

      nodes.push({
        id: `phase-${phase.id}`,
        type: "phaseNode",
        position: { x: baseX, y: curY },
        data: {
          label: phase.name,
          sublabel: `${msgs.length}件のメッセージ`,
          phaseType: phase.phase_type,
          phaseId: phase.id,
          color: meta.color,
          bg: meta.bg,
          border: meta.border,
          href: `/oas/${oaId}/works/${workId}/phases/${phase.id}`,
          messageCount: msgs.length,
          status: statusMap.get(phase.id) ?? "ok",
          isInPath: pathPhaseIds.has(phase.id),
        } satisfies PhaseNodeData,
        style: { width: PHASE_W, height: PHASE_H },
      });

      curY += PHASE_H + MSG_Y_GAP;

      msgs.forEach(msg => {
        const km = MSG_KIND_META[msg.kind] ?? MSG_KIND_META.normal;
        const preview = msg.body
          ? msg.body.slice(0, 28) + (msg.body.length > 28 ? "…" : "")
          : `[${msg.kind}]`;

        nodes.push({
          id: `msg-${msg.id}`,
          type: "messageNode",
          position: { x: baseX + MSG_INDENT, y: curY },
          data: {
            label: preview,
            sublabel: km.label,
            kind: msg.kind,
            color: km.color,
            bg: "#fff",
            border: km.border,
            href: `/oas/${oaId}/works/${workId}/messages/${msg.id}`,
            phaseId: msg.phase_id,
          } satisfies MessageNodeData,
          style: { width: MSG_W, height: MSG_H },
        });

        curY += MSG_H + MSG_V_GAP;
      });

      curY += GROUP_GAP;
    }
  }

  // ── エッジ生成 ────────────────────────────────────
  const internalEdges: LayoutEdge[] = [];
  const rfEdges: Edge[] = [];
  const seenIds = new Set<string>();
  const nodeIds = new Set(nodes.map(n => n.id));

  const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
  const transMap: Record<string, Record<string, string>> = {};
  transitions.forEach(t => {
    if (!transMap[t.from_phase_id]) transMap[t.from_phase_id] = {};
    transMap[t.from_phase_id][norm(t.label)] = t.to_phase_id;
  });

  // QR エッジ
  allMessages.forEach(msg => {
    const qrs = (msg.quick_replies ?? []) as QuickReplyItem[];
    qrs.forEach((item, i) => {
      if (item.enabled === false) return;

      const lbl = (item.label ?? `ボタン${i + 1}`).trim();
      const fromId = `msg-${msg.id}`;
      const eid = `qr-${msg.id}-${i}`;
      if (seenIds.has(eid) || !nodeIds.has(fromId)) return;

      if (item.target_phase_id) {
        const toId = `phase-${item.target_phase_id}`;
        if (nodeIds.has(toId)) {
          seenIds.add(eid);
          const le: LayoutEdge = { id: eid, fromId, toId, label: lbl, color: "#7c3aed", border: "#ddd6fe", kind: "qr-phase", isDefault: false };
          internalEdges.push(le);
        }
      } else if (item.target_type === "message" && item.target_message_id) {
        const toId = `msg-${item.target_message_id}`;
        if (nodeIds.has(toId)) {
          seenIds.add(eid);
          const le: LayoutEdge = { id: eid, fromId, toId, label: lbl, color: "#c2410c", border: "#fed7aa", kind: "qr-message", isDefault: false };
          internalEdges.push(le);
        }
      } else if (item.action !== "hint" && item.action !== "url") {
        const textVal = (item.value?.trim() || item.label).trim();
        const matched = msg.phase_id ? transMap[msg.phase_id]?.[norm(textVal)] : undefined;
        if (matched) {
          const toId = `phase-${matched}`;
          if (nodeIds.has(toId)) {
            seenIds.add(eid);
            const le: LayoutEdge = { id: eid, fromId, toId, label: lbl, color: "#7c3aed", border: "#ddd6fe", kind: "qr-phase", isDefault: false };
            internalEdges.push(le);
          }
        }
      }
    });
  });

  // Transition エッジ
  transitions.forEach(t => {
    const fromId = `phase-${t.from_phase_id}`;
    const toId = `phase-${t.to_phase_id}`;
    if (nodeIds.has(fromId) && nodeIds.has(toId)) {
      const hasCondition = !!(t.condition || t.flag_condition);
      const le: LayoutEdge = {
        id: `trans-${t.id}`,
        fromId, toId,
        label: t.label,
        color: "#94a3b8",
        border: "#e2e8f0",
        kind: "phase-transition",
        condition: t.condition,
        flagCondition: t.flag_condition,
        isDefault: !hasCondition,
        transitionId: t.id,
      };
      internalEdges.push(le);
    }
  });

  // LayoutEdge → React Flow Edge 変換
  for (const le of internalEdges) {
    const isLoop = le.transitionId ? loopTransitionIds.has(le.transitionId) : false;
    rfEdges.push({
      id: le.id,
      source: le.fromId,
      target: le.toId,
      type: "scenarioEdge",
      data: {
        layoutEdge: le,
        isLoop,
        isInPath: le.transitionId ? pathTransitionIds.has(le.transitionId) : false,
      } satisfies ScenarioEdgeData,
    });
  }

  return { nodes, edges: rfEdges, internalEdges };
}
