// scenario/_flow/layout.ts
// dagre による自動レイアウト（既存依存 dagre を利用）。同じ入力に対して常に同じ座標を返す（決定論的）。
// 縦（TB）/横（LR）で rankdir を切り替える。孤立ノード・循環参照があっても dagre 側で処理され破綻しない。

import dagre from "dagre";
import { FLOW_NODE_W, FLOW_NODE_H } from "./constants";

export type FlowDirection = "TB" | "LR";

export interface XY { x: number; y: number }

/**
 * ノード id 群 + エッジから、React Flow 用の左上原点座標を算出する。
 * 孤立ノードもグラフに登録するため画面から消えない（独立領域へ並ぶ）。
 */
export function layoutFlow(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  direction: FlowDirection,
): Map<string, XY> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 130, marginx: 40, marginy: 40 });

  for (const id of nodeIds) g.setNode(id, { width: FLOW_NODE_W, height: FLOW_NODE_H });
  for (const e of edges) {
    // 端点が両方存在する遷移のみ（壊れた参照は build-graph で除去済みだが二重に防御）。
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const pos = new Map<string, XY>();
  for (const id of nodeIds) {
    const n = g.node(id);
    // dagre は中心座標を返す。React Flow は左上原点なので半分ずらす。
    if (n) pos.set(id, { x: n.x - FLOW_NODE_W / 2, y: n.y - FLOW_NODE_H / 2 });
    else pos.set(id, { x: 0, y: 0 });
  }
  return pos;
}
