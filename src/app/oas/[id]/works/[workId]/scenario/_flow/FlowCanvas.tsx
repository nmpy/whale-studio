"use client";

// scenario/_flow/FlowCanvas.tsx
// React Flow による読み取り専用フローキャンバス。書き込みは一切しない
// （nodesDraggable=false / nodesConnectable=false / 位置永続化なし）。
//   - ドットグリッド背景 / ミニマップ（表示範囲マスク・クリック/ドラッグ移動）
//   - ホイールズーム / ドラッグパン / ズーム±・% 表示・フィット・100% / 選択・パンモード切替
//   - 初回表示・縦横切替・リサイズで全体フィット。prefers-reduced-motion を尊重。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, BackgroundVariant, MiniMap, Panel,
  useReactFlow, useViewport, MarkerType,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { FlowNodeData, FlowEdgeData } from "./build-graph";
import { layoutFlow, type FlowDirection } from "./layout";
import { FlowPhaseNode, type PhaseFlowNode } from "./FlowPhaseNode";
import { FlowEdge } from "./FlowEdge";
import { FlowActionsContext, type FlowActions } from "./context";
import { EDGE_TONE_COLOR, PHASE_ACCENT, FLOW_DOT_COLOR, FLOW_MIN_ZOOM, FLOW_MAX_ZOOM } from "./constants";

const nodeTypes = { phaseNode: FlowPhaseNode };
const edgeTypes = { flowEdge: FlowEdge };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const CTRL_BTN: React.CSSProperties = { width: 30, height: 28, border: "1px solid #DFE1E5", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14, color: "#374151", lineHeight: 1 };

// ズーム/フィット/100% + ライブのズーム率表示。useViewport をここに閉じ込め、
// パン・ズーム中にキャンバス全体が再描画されないようにする（過剰再描画の抑制）。
function ZoomControls({ fitDuration }: { fitDuration: number }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const zoomPct = Math.round(zoom * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #ECEEF1", borderRadius: 10, padding: 6, boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
      <button type="button" aria-label="ズームアウト" style={CTRL_BTN} onClick={() => rf.zoomOut({ duration: fitDuration })}>−</button>
      <span aria-live="polite" style={{ minWidth: 44, textAlign: "center", fontSize: 12, fontWeight: 700, color: "#374151" }}>{zoomPct}%</span>
      <button type="button" aria-label="ズームイン" style={CTRL_BTN} onClick={() => rf.zoomIn({ duration: fitDuration })}>＋</button>
      <button type="button" aria-label="全体を表示" style={{ ...CTRL_BTN, width: "auto", padding: "0 10px", fontSize: 12 }} onClick={() => rf.fitView({ padding: 0.15, duration: fitDuration })}>フィット</button>
      <button type="button" aria-label="100%表示" style={{ ...CTRL_BTN, width: "auto", padding: "0 10px", fontSize: 12 }} onClick={() => rf.zoomTo(1, { duration: fitDuration })}>100%</button>
    </div>
  );
}

export interface FlowCanvasProps {
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
  direction: FlowDirection;
  actions: FlowActions;
}

function FlowCanvasInner({ nodes, edges, direction, actions }: FlowCanvasProps) {
  const rf = useReactFlow();
  const [mode, setMode] = useState<"select" | "pan">("pan");
  const fitDuration = prefersReducedMotion() ? 0 : 300;

  // 位置は (nodes, edges, direction) から決定論的に算出。パン・ズーム中は再計算しない。
  const rfNodes: Node[] = useMemo(() => {
    const pos = layoutFlow(nodes.map((n) => n.id), edges, direction);
    return nodes.map((n): PhaseFlowNode => ({
      id: n.id,
      type: "phaseNode",
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: n,
      draggable: false,
      selectable: true,
      focusable: true,
    }));
  }, [nodes, edges, direction]);

  const rfEdges: Edge[] = useMemo(
    () => edges.map((e) => ({
      id: e.id,
      type: "flowEdge",
      source: e.source,
      target: e.target,
      data: { label: e.label, tone: e.tone },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_TONE_COLOR[e.tone].stroke, width: 16, height: 16 },
    })),
    [edges],
  );

  // 初回 + 縦横切替でフィット（位置が変わるため）。
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: fitDuration }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, rfNodes.length]);

  // リサイズ時にビューポート再計測してフィット（過剰発火を防ぐデバウンス）。
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 0 }), 200);
    });
    ro.observe(el);
    return () => { if (t) clearTimeout(t); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const miniMapColor = useCallback((n: Node) => {
    const d = n.data as unknown as FlowNodeData;
    return (PHASE_ACCENT[d?.phaseType] ?? PHASE_ACCENT.normal).accent;
  }, []);

  const toggleBtn = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700,
    background: active ? "#06C755" : "transparent", color: active ? "#fff" : "#6b7280",
  });

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%" }}>
      <FlowActionsContext.Provider value={actions}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={FLOW_MIN_ZOOM}
          maxZoom={FLOW_MAX_ZOOM}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          zoomOnScroll
          panOnScroll={false}
          panOnDrag={mode === "pan"}
          selectionOnDrag={mode === "select"}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          nodeOrigin={[0, 0]}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={FLOW_DOT_COLOR} />
          <MiniMap pannable zoomable nodeColor={miniMapColor} nodeStrokeWidth={2} maskColor="rgba(6,199,85,.08)" style={{ border: "1px solid #06C755", borderRadius: 8 }} />

          {/* 選択 / パン モード切替（左上） */}
          <Panel position="top-left">
            <div role="group" aria-label="操作モード" style={{ display: "flex", gap: 2, background: "#fff", border: "1px solid #ECEEF1", borderRadius: 8, padding: 3, boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
              <button type="button" aria-pressed={mode === "select"} onClick={() => setMode("select")} style={toggleBtn(mode === "select")}>選択</button>
              <button type="button" aria-pressed={mode === "pan"} onClick={() => setMode("pan")} style={toggleBtn(mode === "pan")}>パン</button>
            </div>
          </Panel>

          {/* ズーム / フィット / 100%（右下）── useViewport は ZoomControls 内に閉じ込め、パン中の再描画を抑制 */}
          <Panel position="bottom-right">
            <ZoomControls fitDuration={fitDuration} />
          </Panel>
        </ReactFlow>
      </FlowActionsContext.Provider>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return <FlowCanvasInner {...props} />;
}
