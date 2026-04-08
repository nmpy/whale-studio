// _node-graph/layout/dagre-layout.ts — dagre 自動レイアウト

import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";
import { PHASE_W, PHASE_H, MSG_W, MSG_H, MSG_INDENT, MSG_Y_GAP, MSG_V_GAP } from "../constants";

export type LayoutDirection = "TB" | "LR";

/**
 * dagre でフェーズノードを自動配置し、メッセージノードをフェーズの下に並べる。
 * 孤立ノード（エッジなし）も正しく配置する。
 * 元のnodes配列を変更せず、新しい配列を返す。
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = "TB",
): Node[] {
  const phaseNodes = nodes.filter(n => n.type === "phaseNode");
  const msgNodes = nodes.filter(n => n.type === "messageNode");

  if (phaseNodes.length === 0) return nodes;

  // dagre グラフを構築（フェーズノードのみ）
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 70,
    ranksep: 140,
    marginx: 50,
    marginy: 50,
  });

  // 全フェーズノードを追加（孤立ノード含む）
  for (const node of phaseNodes) {
    g.setNode(node.id, { width: PHASE_W, height: PHASE_H });
  }

  // フェーズ→フェーズのエッジのみ追加
  const phaseIds = new Set(phaseNodes.map(n => n.id));
  for (const edge of edges) {
    if (phaseIds.has(edge.source) && phaseIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  // 結果からフェーズ位置を取得
  const phasePositions: Record<string, { x: number; y: number }> = {};
  for (const node of phaseNodes) {
    const n = g.node(node.id);
    if (n) {
      // dagre は中心座標を返す → 左上に変換
      phasePositions[node.id] = {
        x: n.x - PHASE_W / 2,
        y: n.y - PHASE_H / 2,
      };
    }
  }

  // メッセージノードをフェーズの下(TB)または右(LR)に配置
  const msgByPhase: Record<string, Node[]> = {};
  for (const msg of msgNodes) {
    const phaseId = (msg.data as { phaseId?: string | null })?.phaseId;
    if (!phaseId) continue;
    const key = `phase-${phaseId}`;
    if (!msgByPhase[key]) msgByPhase[key] = [];
    msgByPhase[key].push(msg);
  }

  const msgPositions: Record<string, { x: number; y: number }> = {};
  for (const [phaseNodeId, msgs] of Object.entries(msgByPhase)) {
    const phasePos = phasePositions[phaseNodeId];
    if (!phasePos) continue;

    if (direction === "TB") {
      let curY = phasePos.y + PHASE_H + MSG_Y_GAP;
      for (const msg of msgs) {
        msgPositions[msg.id] = {
          x: phasePos.x + MSG_INDENT,
          y: curY,
        };
        curY += MSG_H + MSG_V_GAP;
      }
    } else {
      // LR: メッセージをフェーズの下に配置
      let curY = phasePos.y + PHASE_H + MSG_Y_GAP;
      for (const msg of msgs) {
        msgPositions[msg.id] = {
          x: phasePos.x,
          y: curY,
        };
        curY += MSG_H + MSG_V_GAP;
      }
    }
  }

  // フェーズに属さないメッセージノードは最後にまとめて配置
  const orphanMsgs = msgNodes.filter(m => {
    const phaseId = (m.data as { phaseId?: string | null })?.phaseId;
    return !phaseId || !phasePositions[`phase-${phaseId}`];
  });
  if (orphanMsgs.length > 0) {
    // 全フェーズの右下に配置
    let maxX = 0, maxY = 0;
    for (const pos of Object.values(phasePositions)) {
      maxX = Math.max(maxX, pos.x + PHASE_W);
      maxY = Math.max(maxY, pos.y);
    }
    let orphanY = maxY;
    for (const msg of orphanMsgs) {
      msgPositions[msg.id] = { x: maxX + 60, y: orphanY };
      orphanY += MSG_H + MSG_V_GAP;
    }
  }

  // 新しいノード配列を返す
  return nodes.map(node => {
    const pos = phasePositions[node.id] ?? msgPositions[node.id];
    if (pos) {
      return { ...node, position: { x: pos.x, y: pos.y } };
    }
    return node;
  });
}
