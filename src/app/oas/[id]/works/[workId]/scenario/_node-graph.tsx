"use client";

// src/app/oas/[id]/works/[workId]/scenario/_node-graph.tsx
// ノードグラフビュー — React Flow ベース

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { NodeGraphProps } from "./_node-graph/types";
import { analyzeGraph, getAncestorPath } from "./_node-graph/analysis/graph-analysis";
import { toReactFlowElements } from "./_node-graph/layout/compute-elements";
import { applyDagreLayout, type LayoutDirection } from "./_node-graph/layout/dagre-layout";
import { useGraphValidation } from "./_node-graph/hooks/use-graph-validation";
import { useUndoRedo } from "./_node-graph/hooks/use-undo-redo";
import { PhaseNode } from "./_node-graph/nodes/PhaseNode";
import { MessageNode } from "./_node-graph/nodes/MessageNode";
import { ScenarioEdge } from "./_node-graph/edges/ScenarioEdge";
import { RightPanel } from "./_node-graph/panels/RightPanel";
import { Toolbar } from "./_node-graph/ui/Toolbar";
import { WarningBanner } from "./_node-graph/ui/WarningBanner";
import { Legend } from "./_node-graph/ui/Legend";
import { BackgroundClickForm } from "./_node-graph/ui/BackgroundClickForm";
import { PHASE_META } from "./_node-graph/constants";

// ── React Flow ノード・エッジ型登録 ──────────────────
const nodeTypes = {
  phaseNode: PhaseNode,
  messageNode: MessageNode,
};

const edgeTypes = {
  scenarioEdge: ScenarioEdge,
};

// ── 内部コンポーネント（ReactFlowProvider の中で使用） ──
function NodeGraphInner({
  phases,
  transitions,
  allMessages,
  oaId,
  workId,
  canEdit = false,
  onDataMutated,
}: NodeGraphProps) {
  const reactFlowInstance = useReactFlow();

  // ── グラフ分析 ────────────────────────────────────
  const graphAnalysis = useMemo(
    () => analyzeGraph(phases, transitions),
    [phases, transitions],
  );

  // ── 選択フェーズ ──────────────────────────────────
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [prefillTargetPhaseId, setPrefillTargetPhaseId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);

  // ── パスハイライト ────────────────────────────────
  const ancestorPath = useMemo(() => {
    if (!selectedPhaseId) return null;
    return getAncestorPath(selectedPhaseId, transitions);
  }, [selectedPhaseId, transitions]);

  const pathPhaseIds = useMemo(() => {
    if (!ancestorPath) return new Set<string>();
    return ancestorPath.pathPhaseIds;
  }, [ancestorPath]);

  const pathTransitionIds = useMemo(() => {
    if (!ancestorPath) return new Set<string>();
    return ancestorPath.pathTransitionIds;
  }, [ancestorPath]);

  // ── バリデーション ────────────────────────────────
  const { statusMap, errors: validationErrors } = useGraphValidation(
    phases, transitions, graphAnalysis,
  );

  // ── React Flow 要素を生成 ─────────────────────────
  const { nodes: rawNodes, edges: rawEdges, internalEdges } = useMemo(
    () => toReactFlowElements(
      phases, transitions, allMessages, oaId, workId,
      statusMap, pathPhaseIds, pathTransitionIds,
    ),
    [phases, transitions, allMessages, oaId, workId, statusMap, pathPhaseIds, pathTransitionIds],
  );

  // ── dagre レイアウト適用 ──────────────────────────
  const layoutApplied = useRef(false);
  const initialLayoutNodes = useMemo(() => {
    return applyDagreLayout(rawNodes, rawEdges, "TB");
  }, [rawNodes, rawEdges]);

  // ── Undo/Redo ─────────────────────────────────────
  const {
    nodes: undoNodes,
    edges: undoEdges,
    pushSnapshot,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
  } = useUndoRedo(initialLayoutNodes, rawEdges);

  // データ変更時にリセット
  const prevDataRef = useRef({ phases, transitions, allMessages });
  useEffect(() => {
    const prev = prevDataRef.current;
    if (prev.phases !== phases || prev.transitions !== transitions || prev.allMessages !== allMessages) {
      prevDataRef.current = { phases, transitions, allMessages };
      const newLayoutNodes = applyDagreLayout(rawNodes, rawEdges, "TB");
      reset(newLayoutNodes, rawEdges);
      layoutApplied.current = false;
    }
  }, [phases, transitions, allMessages, rawNodes, rawEdges, reset]);

  // ── React Flow state ──────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState(undoNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(undoEdges);

  // Undo/Redo state → React Flow state 同期
  useEffect(() => {
    setNodes(undoNodes);
    setEdges(undoEdges);
  }, [undoNodes, undoEdges, setNodes, setEdges]);

  // ── 背景クリックでフェーズ追加 ────────────────────
  const [bgClickPos, setBgClickPos] = useState<{ x: number; y: number } | null>(null);

  // ── 保存状態表示 ──────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function handleMutationStart() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
  }

  function handleDataMutated() {
    setPrefillTargetPhaseId(null);
    setSaveStatus("saved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    onDataMutated();
  }

  // ── ノードクリック ────────────────────────────────
  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === "phaseNode") {
      const phaseId = (node.data as { phaseId: string }).phaseId;
      setSelectedPhaseId(prev => prev === phaseId ? null : phaseId);
      setPrefillTargetPhaseId(null);
      setBgClickPos(null);
      setSelectedTransitionId(null);
    }
  }, []);

  // ── ノードダブルクリックでページ遷移 ──────────────
  const handleNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    const href = (node.data as { href: string }).href;
    if (href) {
      window.location.href = href;
    }
  }, []);

  // ── エッジクリック ────────────────────────────────
  const handleEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    const data = edge.data as { layoutEdge: { kind: string; transitionId?: string } } | undefined;
    if (data?.layoutEdge.kind === "phase-transition" && data.layoutEdge.transitionId) {
      const t = transitions.find(tr => tr.id === data.layoutEdge.transitionId);
      if (t) {
        setSelectedTransitionId(data.layoutEdge.transitionId);
        setSelectedPhaseId(t.from_phase_id);
        setPrefillTargetPhaseId(null);
        setBgClickPos(null);
      }
    }
  }, [transitions]);

  // ── 背景クリック ──────────────────────────────────
  const handlePaneClick = useCallback((event: React.MouseEvent) => {
    if (!canEdit) return;
    setSelectedPhaseId(null);
    setPrefillTargetPhaseId(null);
    setSelectedTransitionId(null);

    // 背景クリック位置にフェーズ追加フォーム
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    setBgClickPos(position);
  }, [canEdit, reactFlowInstance]);

  // ── 接続（ドラッグ） ─────────────────────────────
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // source / target は "phase-{id}" 形式
    const fromPhaseId = connection.source.replace("phase-", "");
    const toPhaseId = connection.target.replace("phase-", "");
    if (fromPhaseId === toPhaseId) return;

    // RightPanel を開いて遷移追加フォームをプリフィル
    setSelectedPhaseId(fromPhaseId);
    setPrefillTargetPhaseId(toPhaseId);
    setBgClickPos(null);
    setSelectedTransitionId(null);
  }, []);

  // ── 接続バリデーション ────────────────────────────
  const isValidConnection = useCallback((connection: Connection | { source?: string | null; target?: string | null }) => {
    const src = connection.source;
    const tgt = connection.target;
    // フェーズ→フェーズのみ許可
    if (!src?.startsWith("phase-")) return false;
    if (!tgt?.startsWith("phase-")) return false;
    if (src === tgt) return false;
    // ending からの接続は不可
    const fromPhaseId = src.replace("phase-", "");
    const fromPhase = phases.find(p => p.id === fromPhaseId);
    if (fromPhase?.phase_type === "ending") return false;
    return true;
  }, [phases]);

  // ── ノードドラッグ完了時にスナップショット ────────
  const handleNodeDragStop: NodeMouseHandler = useCallback(() => {
    pushSnapshot(nodes, edges);
  }, [nodes, edges, pushSnapshot]);

  // ── 自動レイアウト ────────────────────────────────
  const handleAutoLayout = useCallback((direction: LayoutDirection) => {
    const newNodes = applyDagreLayout(nodes, edges, direction);
    pushSnapshot(newNodes, edges);
    setNodes(newNodes);
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
    }, 50);
  }, [nodes, edges, pushSnapshot, setNodes, reactFlowInstance]);

  // ── Fit View ──────────────────────────────────────
  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
  }, [reactFlowInstance]);

  // ── キーボードショートカット ──────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes("Mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      // Windows: Ctrl+Y
      if (mod && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── エラーフォーカス ──────────────────────────────
  const handleFocusNode = useCallback((phaseId: string) => {
    const nodeId = `phase-${phaseId}`;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setSelectedPhaseId(phaseId);

    reactFlowInstance.fitView({
      nodes: [{ id: nodeId }],
      padding: 0.5,
      duration: 400,
    });
  }, [nodes, reactFlowInstance]);

  // ── 初期 fitView ──────────────────────────────────
  useEffect(() => {
    if (!layoutApplied.current && nodes.length > 0) {
      layoutApplied.current = true;
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.15, duration: 0 });
      }, 100);
    }
  }, [nodes.length, reactFlowInstance]);

  const selectedPhase = selectedPhaseId
    ? phases.find(p => p.id === selectedPhaseId) ?? null
    : null;
  const hasEnding = phases.some(p => p.phase_type === "ending");
  const hasStart = phases.some(p => p.phase_type === "start");

  // ── ミニマップ nodeColor ──────────────────────────
  const miniMapNodeColor = useCallback((node: { type?: string; data: Record<string, unknown> }) => {
    if (node.type === "phaseNode") {
      return (node.data.color as string) ?? "#94a3b8";
    }
    return "#e2e8f0";
  }, []);

  return (
    <div>
      {/* 警告バナー */}
      <WarningBanner
        errors={validationErrors}
        hasEndingReachable={graphAnalysis.hasEndingReachable}
        hasEnding={hasEnding}
        hasStart={hasStart}
        phaseCount={phases.length}
        onFocusNode={handleFocusNode}
      />

      {/* メインレイアウト */}
      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
        {/* React Flow キャンバス */}
        <div
          style={{
            flex: 1,
            position: "relative",
            minWidth: 0,
            height: 680,
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: selectedPhase ? "14px 0 0 14px" : 14,
            overflow: "hidden",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onEdgeClick={handleEdgeClick}
            onPaneClick={handlePaneClick}
            onNodeDragStop={handleNodeDragStop}
            fitView
            minZoom={0.1}
            maxZoom={3}
            defaultEdgeOptions={{ type: "scenarioEdge" }}
            proOptions={{ hideAttribution: true }}
            style={{ background: "transparent" }}
            deleteKeyCode={null}
            selectionKeyCode={null}
          >
            <Background variant={"dots" as any} gap={24} size={0.8} color="#cbd5e1" />

            <MiniMap
              nodeColor={miniMapNodeColor}
              maskColor="rgba(241,245,249,0.7)"
              style={{
                bottom: 14,
                right: 14,
                width: 160,
                height: 100,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              }}
              pannable
              zoomable
            />

            <Controls
              position="bottom-left"
              showInteractive={false}
              style={{
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                boxShadow: "0 2px 10px rgba(0,0,0,0.09)",
              }}
            />
          </ReactFlow>

          {/* ツールバー */}
          <Toolbar
            onAutoLayout={handleAutoLayout}
            onFitView={handleFitView}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />

          {/* 凡例 */}
          <Legend />

          {/* 保存状態 */}
          {saveStatus !== "idle" && (
            <div style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 11,
              color: saveStatus === "saving" ? "#6b7280" : "#16a34a",
              background: "white",
              border: `1px solid ${saveStatus === "saving" ? "#e2e8f0" : "#bbf7d0"}`,
              borderRadius: 6,
              padding: "3px 12px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
              zIndex: 20,
            }}>
              {saveStatus === "saving" ? "保存中…" : "✓ 保存完了"}
            </div>
          )}

          {/* 背景クリック：フェーズ追加フォーム */}
          {bgClickPos && canEdit && (
            <BackgroundClickForm
              workId={workId}
              position={{ x: bgClickPos.x, y: bgClickPos.y }}
              hasStart={hasStart}
              onCreated={() => {
                setBgClickPos(null);
                onDataMutated();
              }}
              onCancel={() => setBgClickPos(null)}
            />
          )}

          {/* ノードが0件のときの空状態 */}
          {nodes.length === 0 && (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#94a3b8", fontSize: 14,
              pointerEvents: "none",
            }}>
              フェーズを追加するとノードが表示されます
            </div>
          )}
        </div>

        {/* 右パネル */}
        {selectedPhase && (
          <div style={{
            width: 300,
            flexShrink: 0,
            overflowY: "auto",
            background: "#fff",
            borderRadius: "0 14px 14px 0",
            border: "1px solid #e2e8f0",
            borderLeft: "none",
          }}>
            <RightPanel
              phase={selectedPhase}
              transitions={transitions}
              phases={phases}
              oaId={oaId}
              workId={workId}
              canEdit={canEdit}
              onClose={() => {
                setSelectedPhaseId(null);
                setPrefillTargetPhaseId(null);
                setSelectedTransitionId(null);
              }}
              onDataMutated={handleDataMutated}
              prefillTargetPhaseId={prefillTargetPhaseId}
              focusedTransitionId={selectedTransitionId}
              onMutationStart={handleMutationStart}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 公開コンポーネント（Provider でラップ） ─────────
export function NodeGraph(props: NodeGraphProps) {
  return (
    <ReactFlowProvider>
      <NodeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
