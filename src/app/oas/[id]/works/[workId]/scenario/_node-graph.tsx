"use client";

// src/app/oas/[id]/works/[workId]/scenario/_node-graph.tsx
// ノードグラフビュー — React Flow ベース（P4 運用仕上げ版）

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
  type OnSelectionChangeParams,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { NodeGraphProps, SelectedEntity } from "./_node-graph/types";
import { analyzeGraph, getAncestorPath } from "./_node-graph/analysis/graph-analysis";
import { toReactFlowElements } from "./_node-graph/layout/compute-elements";
import { applyDagreLayout, type LayoutDirection } from "./_node-graph/layout/dagre-layout";
import { useGraphValidation } from "./_node-graph/hooks/use-graph-validation";
import { useUndoRedo } from "./_node-graph/hooks/use-undo-redo";
import { useLayoutPersistence } from "./_node-graph/hooks/use-layout-persistence";
import { DirectionContext } from "./_node-graph/hooks/use-direction-context";
import { DisplayModeContext, type DisplayMode } from "./_node-graph/hooks/use-display-mode";
import { useOperationTracker } from "./_node-graph/hooks/use-operation-tracker";
import { PhaseNode } from "./_node-graph/nodes/PhaseNode";
import { MessageNode } from "./_node-graph/nodes/MessageNode";
import { ScenarioEdge } from "./_node-graph/edges/ScenarioEdge";
import { RightPanel } from "./_node-graph/panels/RightPanel";
import { Toolbar } from "./_node-graph/ui/Toolbar";
import { WarningBanner } from "./_node-graph/ui/WarningBanner";
import { Legend } from "./_node-graph/ui/Legend";
import { BackgroundClickForm } from "./_node-graph/ui/BackgroundClickForm";
import { NodeSearch } from "./_node-graph/ui/NodeSearch";
import { ContextMenu, type ContextMenuItem } from "./_node-graph/ui/ContextMenu";
import { useGraphToast, GraphToastContainer } from "./_node-graph/ui/ErrorToast";
import { EdgeDropCreateForm } from "./_node-graph/ui/EdgeDropCreateForm";
import { phaseApi, messageApi, transitionApi, getDevToken } from "@/lib/api-client";

// ── React Flow ノード・エッジ型登録（モジュールレベル — CRITICAL） ──
const nodeTypes = { phaseNode: PhaseNode, messageNode: MessageNode } as const;
const edgeTypes = { scenarioEdge: ScenarioEdge } as const;

// ── コンテキストメニュー / エッジドロップ state 型 ──
interface CtxMenuState { x: number; y: number; items: ContextMenuItem[] }
interface EdgeDropState { fromPhaseId: string; position: { x: number; y: number } }

// ── 内部コンポーネント ──────────────────────────────
function NodeGraphInner({
  phases, transitions, allMessages, oaId, workId,
  canEdit = false, onDataMutated, onValidationChange,
}: NodeGraphProps) {
  const reactFlowInstance = useReactFlow();
  const { toasts, showError, showSuccess } = useGraphToast();
  const { track } = useOperationTracker();

  // ── グラフ分析 ────────────────────────────────────
  const graphAnalysis = useMemo(() => analyzeGraph(phases, transitions), [phases, transitions]);

  // ── 選択状態 ──────────────────────────────────────
  const [selected, setSelected] = useState<SelectedEntity>(null);
  const selectedPhaseId = selected?.type === "phase" ? selected.phaseId
    : selected?.type === "transition" ? selected.fromPhaseId : null;
  const prefillTargetPhaseId = selected?.type === "phase" ? (selected.prefillTargetPhaseId ?? null) : null;
  const selectedTransitionId = selected?.type === "transition" ? selected.transitionId : null;

  // ── パスハイライト ────────────────────────────────
  const ancestorPath = useMemo(() => selectedPhaseId ? getAncestorPath(selectedPhaseId, transitions) : null, [selectedPhaseId, transitions]);
  const pathPhaseIds = useMemo(() => ancestorPath?.pathPhaseIds ?? new Set<string>(), [ancestorPath]);
  const pathTransitionIds = useMemo(() => ancestorPath?.pathTransitionIds ?? new Set<string>(), [ancestorPath]);

  // ── バリデーション ────────────────────────────────
  const { statusMap, errors: validationErrors } = useGraphValidation(phases, transitions, graphAnalysis);
  useEffect(() => {
    if (!onValidationChange) return;
    const ec = validationErrors.filter(e => e.severity === "error").length;
    const wc = validationErrors.filter(e => e.severity === "warning").length;
    onValidationChange({ hasBlockingErrors: ec > 0, errorCount: ec, warningCount: wc });
  }, [validationErrors, onValidationChange]);

  // ── React Flow 要素生成 ──────────────────────────
  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => toReactFlowElements(phases, transitions, allMessages, oaId, workId, statusMap, pathPhaseIds, pathTransitionIds, graphAnalysis.loopTransitionIds),
    [phases, transitions, allMessages, oaId, workId, statusMap, pathPhaseIds, pathTransitionIds, graphAnalysis.loopTransitionIds],
  );

  // ── レイアウト ────────────────────────────────────
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("TB");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("standard");
  const { applyPersistedPositions, hasPersistedLayout, persistPositions, clearPersistedLayout } = useLayoutPersistence(workId);

  const initialLayoutNodes = useMemo(() => {
    const d = applyDagreLayout(rawNodes, rawEdges, layoutDirection);
    return hasPersistedLayout() ? applyPersistedPositions(d) : d;
  }, [rawNodes, rawEdges, layoutDirection, applyPersistedPositions, hasPersistedLayout]);

  // ── Undo/Redo ─────────────────────────────────────
  const { nodes: undoNodes, edges: undoEdges, pushSnapshot, undo, redo, reset, canUndo, canRedo } = useUndoRedo(initialLayoutNodes, rawEdges);

  const prevDataKeyRef = useRef("");
  useEffect(() => {
    const key = `${phases.length}-${transitions.length}-${allMessages.length}-${phases.map(p => p.id).join(",")}`;
    if (prevDataKeyRef.current && prevDataKeyRef.current !== key) {
      const n = applyDagreLayout(rawNodes, rawEdges, layoutDirection);
      reset(hasPersistedLayout() ? applyPersistedPositions(n) : n, rawEdges);
    }
    prevDataKeyRef.current = key;
  }, [phases, transitions, allMessages, rawNodes, rawEdges, layoutDirection, reset, hasPersistedLayout, applyPersistedPositions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(undoNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(undoEdges);
  useEffect(() => { setNodes(undoNodes); setEdges(undoEdges); }, [undoNodes, undoEdges, setNodes, setEdges]);

  // ── UI state ──────────────────────────────────────
  const [bgClickPos, setBgClickPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [edgeDrop, setEdgeDrop] = useState<EdgeDropState | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const handleMutationStart = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
  }, []);

  const handleDataMutated = useCallback(() => {
    setSelected(prev => prev?.type === "phase" ? { ...prev, prefillTargetPhaseId: null } : prev);
    setSaveStatus("saved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    onDataMutated();
  }, [onDataMutated]);

  // ── ノードクリック ────────────────────────────────
  const handleNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    if (node.type === "phaseNode") {
      const phaseId = (node.data as { phaseId: string }).phaseId;
      setSelected(prev => prev?.type === "phase" && prev.phaseId === phaseId ? null : { type: "phase", phaseId });
      setBgClickPos(null); setEdgeDrop(null);
    }
    setCtxMenu(null);
  }, []);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback((_e, node) => {
    const href = (node.data as { href: string }).href;
    if (href) window.location.href = href;
  }, []);

  const handleEdgeClick: EdgeMouseHandler = useCallback((_e, edge) => {
    const data = edge.data as { layoutEdge: { kind: string; transitionId?: string } } | undefined;
    if (data?.layoutEdge.kind === "phase-transition" && data.layoutEdge.transitionId) {
      const t = transitions.find(tr => tr.id === data.layoutEdge.transitionId);
      if (t) { setSelected({ type: "transition", transitionId: data.layoutEdge.transitionId, fromPhaseId: t.from_phase_id }); setBgClickPos(null); }
    }
    setCtxMenu(null);
  }, [transitions]);

  const handlePaneClick = useCallback((event: React.MouseEvent) => {
    setSelected(null); setCtxMenu(null); setEdgeDrop(null);
    if (!canEdit) return;
    setBgClickPos(reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [canEdit, reactFlowInstance]);

  // ── 接続（既存ノードへのドラッグ） ───────────────
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const fromId = connection.source.replace("phase-", "");
    const toId = connection.target.replace("phase-", "");
    if (fromId === toId) return;
    setSelected({ type: "phase", phaseId: fromId, prefillTargetPhaseId: toId });
    setBgClickPos(null); setEdgeDrop(null);
  }, []);

  // ── エッジドラッグ→空白ドロップ（P4-1 新規作成） ──
  const connectingNodeRef = useRef<string | null>(null);

  const handleConnectStart = useCallback((_: unknown, params: { nodeId?: string | null }) => {
    connectingNodeRef.current = params.nodeId ?? null;
  }, []);

  const handleConnectEnd: OnConnectEnd = useCallback((event) => {
    if (!canEdit || !connectingNodeRef.current) return;
    // ターゲットが既存ノードだったら何もしない（handleConnect で処理済み）
    const target = (event as MouseEvent).target as HTMLElement;
    if (target?.closest?.(".react-flow__handle")) return;

    const fromPhaseId = connectingNodeRef.current.replace("phase-", "");
    const fromPhase = phases.find(p => p.id === fromPhaseId);
    if (!fromPhase || fromPhase.phase_type === "ending") return;

    // 空白にドロップ → 新規フェーズ作成フォーム表示
    const me = event as MouseEvent;
    const position = reactFlowInstance.screenToFlowPosition({ x: me.clientX, y: me.clientY });
    setEdgeDrop({ fromPhaseId, position });
    setBgClickPos(null);
    track("edge_drag_create", { fromPhaseId });
    connectingNodeRef.current = null;
  }, [canEdit, phases, reactFlowInstance, track]);

  const isValidConnection = useCallback((connection: Connection | { source?: string | null; target?: string | null }) => {
    const src = connection.source; const tgt = connection.target;
    if (!src?.startsWith("phase-") || !tgt?.startsWith("phase-") || src === tgt) return false;
    const fromPhase = phases.find(p => p.id === src.replace("phase-", ""));
    return fromPhase?.phase_type !== "ending";
  }, [phases]);

  // ── ドラッグ完了 ──────────────────────────────────
  const handleNodeDragStop = useCallback(() => {
    pushSnapshot(nodes, edges);
    persistPositions(nodes);
  }, [nodes, edges, pushSnapshot, persistPositions]);

  // ── 自動レイアウト ────────────────────────────────
  const handleAutoLayout = useCallback((direction: LayoutDirection) => {
    setLayoutDirection(direction);
    const n = applyDagreLayout(nodes, edges, direction);
    pushSnapshot(n, edges); setNodes(n);
    clearPersistedLayout(); persistPositions(n);
    setTimeout(() => reactFlowInstance.fitView({ padding: 0.15, duration: 300 }), 50);
    track("auto_layout", { direction });
  }, [nodes, edges, pushSnapshot, setNodes, reactFlowInstance, clearPersistedLayout, persistPositions, track]);

  const handleFitView = useCallback(() => reactFlowInstance.fitView({ padding: 0.15, duration: 300 }), [reactFlowInstance]);

  // ── キーボード ────────────────────────────────────
  const undoRef = useRef(undo); const redoRef = useRef(redo);
  useEffect(() => { undoRef.current = undo; }, [undo]);
  useEffect(() => { redoRef.current = redo; }, [redo]);

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes("Mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); track("undo"); return; }
      if ((mod && e.key === "z" && e.shiftKey) || (mod && e.key === "y")) { e.preventDefault(); redoRef.current(); track("redo"); return; }
      if (e.key === "Escape") { setSelected(null); setBgClickPos(null); setCtxMenu(null); setEdgeDrop(null); return; }
      if (isInputFocused()) return;
      if ((e.key === "Delete" || e.key === "Backspace") && canEdit) {
        if (selected?.type === "phase") { e.preventDefault(); handleDeletePhase(selected.phaseId); }
        else if (selected?.type === "multi") { e.preventDefault(); handleBulkDelete(selected.nodeIds); }
        return;
      }
      if (mod && e.key === "d" && selected?.type === "phase" && canEdit) {
        e.preventDefault(); handleDuplicatePhase(selected.phaseId); return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected, canEdit]);

  // ── フェーズ削除 ──────────────────────────────────
  async function handleDeletePhase(phaseId: string) {
    const phase = phases.find(p => p.id === phaseId);
    if (!phase) return;
    if (phase.phase_type === "global") { showError("共通フェーズは削除できません"); return; }
    const tc = transitions.filter(t => t.from_phase_id === phaseId || t.to_phase_id === phaseId).length;
    const msg = tc > 0
      ? `フェーズ「${phase.name}」を削除しますか？\n関連する${tc}件の遷移も削除されます。\nこの操作はUndo (Ctrl+Z) で元に戻せます。`
      : `フェーズ「${phase.name}」を削除しますか？\nこの操作はUndo (Ctrl+Z) で元に戻せます。`;
    if (!confirm(msg)) return;
    handleMutationStart();
    try {
      await phaseApi.delete(getDevToken(), phaseId);
      setSelected(null); handleDataMutated(); track("phase_delete");
    } catch (err) { console.error(err); showError("フェーズの削除に失敗しました"); }
  }

  async function handleBulkDelete(nodeIds: string[]) {
    const ids = nodeIds.map(id => id.replace("phase-", ""));
    const deletable = ids.map(id => phases.find(p => p.id === id)).filter(p => p && p.phase_type !== "global");
    if (deletable.length === 0) { showError("削除可能なフェーズがありません"); return; }
    if (!confirm(`${deletable.length}件のフェーズを削除しますか？\n関連する遷移も削除されます。\nこの操作はUndo (Ctrl+Z) で元に戻せます。`)) return;
    handleMutationStart();
    try {
      for (const p of deletable) await phaseApi.delete(getDevToken(), p!.id);
      setSelected(null); handleDataMutated(); track("phase_bulk_delete", { count: deletable.length });
    } catch (err) { console.error(err); showError("一括削除に失敗しました"); }
  }

  // ── フェーズ複製 ──────────────────────────────────
  async function handleDuplicatePhase(phaseId: string) {
    const phase = phases.find(p => p.id === phaseId);
    if (!phase) return;
    handleMutationStart();
    try {
      const token = getDevToken();
      const names = phases.map(p => p.name);
      let title = `${phase.name} (コピー)`;
      if (names.includes(title)) { for (let i = 2; i < 100; i++) { const n = `${phase.name} (コピー${i})`; if (!names.includes(n)) { title = n; break; } } }
      const np = await phaseApi.create(token, { work_id: workId, name: title, phase_type: phase.phase_type === "start" ? "normal" : phase.phase_type });
      const msgs = await messageApi.list(token, workId, { phase_id: phaseId });
      for (const m of msgs) await messageApi.create(token, { work_id: workId, phase_id: np.id, message_type: m.message_type, kind: m.kind, body: m.body ?? undefined, asset_url: m.asset_url ?? undefined, sort_order: m.sort_order, is_active: m.is_active, character_id: m.character_id ?? undefined });
      handleDataMutated();
      showSuccess(`「${title}」を複製しました`);
      setSelected({ type: "phase", phaseId: np.id });
      setTimeout(() => reactFlowInstance.fitView({ nodes: [{ id: `phase-${np.id}` }], padding: 0.5, duration: 400 }), 200);
      track("phase_duplicate");
    } catch (err) { console.error(err); showError("フェーズの複製に失敗しました"); }
  }

  // ── エッジドロップ→新規作成完了 ──────────────────
  const handleEdgeDropCreated = useCallback((newPhaseId: string) => {
    setEdgeDrop(null);
    handleDataMutated();
    showSuccess("フェーズを作成して接続しました");
    setSelected({ type: "phase", phaseId: newPhaseId });
    setTimeout(() => reactFlowInstance.fitView({ nodes: [{ id: `phase-${newPhaseId}` }], padding: 0.5, duration: 400 }), 200);
  }, [handleDataMutated, showSuccess, reactFlowInstance]);

  // ── 右クリック ────────────────────────────────────
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: { type?: string; data: Record<string, unknown>; id: string }) => {
    event.preventDefault();
    if (node.type !== "phaseNode") return;
    const phaseId = (node.data as { phaseId: string }).phaseId;
    const phase = phases.find(p => p.id === phaseId);
    if (!phase) return;
    setSelected({ type: "phase", phaseId }); setBgClickPos(null); setEdgeDrop(null);
    const items: ContextMenuItem[] = [
      { label: "フェーズ詳細を開く", icon: "📝", onClick: () => { const h = (node.data as { href: string }).href; if (h) window.location.href = h; } },
    ];
    if (canEdit) {
      items.push(
        { label: "複製 (Ctrl+D)", icon: "⧉", onClick: () => handleDuplicatePhase(phaseId) },
        { label: "削除", icon: "🗑", danger: true, disabled: phase.phase_type === "global", onClick: () => handleDeletePhase(phaseId) },
      );
    }
    setCtxMenu({ x: event.clientX, y: event.clientY, items });
    track("context_menu", { target: "node" });
  }, [phases, canEdit, track]);

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: { data?: unknown; id: string }) => {
    event.preventDefault();
    const data = edge.data as { layoutEdge: { kind: string; transitionId?: string } } | undefined;
    if (!data?.layoutEdge.transitionId) return;
    const tid = data.layoutEdge.transitionId;
    const t = transitions.find(tr => tr.id === tid);
    if (!t) return;
    setSelected({ type: "transition", transitionId: tid, fromPhaseId: t.from_phase_id });
    const items: ContextMenuItem[] = [
      { label: "遷移を編集", icon: "✏", onClick: () => setSelected({ type: "transition", transitionId: tid, fromPhaseId: t.from_phase_id }) },
    ];
    if (canEdit) {
      items.push({
        label: "遷移を削除", icon: "🗑", danger: true,
        onClick: async () => {
          if (!confirm("この遷移を削除しますか？")) return;
          handleMutationStart();
          try { await transitionApi.delete(getDevToken(), tid); setSelected(null); handleDataMutated(); track("transition_delete"); }
          catch (err) { console.error(err); showError("遷移の削除に失敗しました"); }
        },
      });
    }
    setCtxMenu({ x: event.clientX, y: event.clientY, items });
    track("context_menu", { target: "edge" });
  }, [transitions, canEdit, handleMutationStart, handleDataMutated, showError, track]);

  const handlePaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setSelected(null); setEdgeDrop(null);
    const items: ContextMenuItem[] = [];
    if (canEdit) items.push({ label: "新規フェーズを追加", icon: "＋", onClick: () => setBgClickPos(reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })) });
    items.push(
      { label: "全体を表示", icon: "⊡", onClick: handleFitView },
      { label: "自動整形（縦型）", icon: "↕", onClick: () => handleAutoLayout("TB") },
      { label: "自動整形（横型）", icon: "↔", onClick: () => handleAutoLayout("LR") },
    );
    setCtxMenu({ x: event.clientX, y: event.clientY, items });
    track("context_menu", { target: "pane" });
  }, [canEdit, handleFitView, handleAutoLayout, reactFlowInstance, track]);

  // ── 複数選択 ──────────────────────────────────────
  const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const ids = params.nodes.filter(n => n.type === "phaseNode").map(n => n.id);
    if (ids.length > 1) setSelected({ type: "multi", nodeIds: ids });
  }, []);

  // ── 検索 ──────────────────────────────────────────
  const handleSearchFocus = useCallback((nodeId: string) => {
    const phaseId = nodeId.startsWith("phase-") ? nodeId.replace("phase-", "") : null;
    if (phaseId) setSelected({ type: "phase", phaseId });
    reactFlowInstance.fitView({ nodes: [{ id: nodeId }], padding: 0.5, duration: 400 });
    track("search");
  }, [reactFlowInstance, track]);

  const handleFocusNode = useCallback((phaseId: string) => {
    setSelected({ type: "phase", phaseId });
    reactFlowInstance.fitView({ nodes: [{ id: `phase-${phaseId}` }], padding: 0.5, duration: 400 });
  }, [reactFlowInstance]);

  // ── 初期 fitView ──────────────────────────────────
  const layoutApplied = useRef(false);
  useEffect(() => {
    if (!layoutApplied.current && nodes.length > 0) {
      layoutApplied.current = true;
      setTimeout(() => reactFlowInstance.fitView({ padding: 0.15, duration: 0 }), 100);
    }
  }, [nodes.length, reactFlowInstance]);

  const selectedPhase = selectedPhaseId ? phases.find(p => p.id === selectedPhaseId) ?? null : null;
  const hasEnding = phases.some(p => p.phase_type === "ending");
  const hasStart = phases.some(p => p.phase_type === "start");
  const miniMapNodeColor = useCallback((node: { type?: string; data: Record<string, unknown> }) => node.type === "phaseNode" ? ((node.data.color as string) ?? "#94a3b8") : "#e2e8f0", []);
  const isMultiSelect = selected?.type === "multi";
  const multiCount = isMultiSelect ? selected.nodeIds.length : 0;

  // ── 複数選択中のフェーズ名一覧（先頭3件） ────────
  const multiPhaseNames = useMemo(() => {
    if (!isMultiSelect) return [];
    return selected.nodeIds.slice(0, 3).map(id => {
      const phaseId = id.replace("phase-", "");
      return phases.find(p => p.id === phaseId)?.name ?? phaseId;
    });
  }, [isMultiSelect, selected, phases]);

  return (
    <DirectionContext.Provider value={layoutDirection}>
    <DisplayModeContext.Provider value={displayMode}>
      <div>
        <WarningBanner errors={validationErrors} hasEndingReachable={graphAnalysis.hasEndingReachable} hasEnding={hasEnding} hasStart={hasStart} phaseCount={phases.length} onFocusNode={handleFocusNode} />

        <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
          <div style={{
            flex: 1, position: "relative", minWidth: 0, height: 680,
            background: "#f1f5f9", border: "1px solid #e2e8f0",
            borderRadius: (selectedPhase || isMultiSelect) ? "14px 0 0 14px" : 14,
            overflow: "hidden",
          }}>
            <ReactFlow
              nodes={nodes} edges={edges}
              nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={handleConnect} isValidConnection={isValidConnection}
              onConnectStart={handleConnectStart as any}
              onConnectEnd={handleConnectEnd}
              onNodeClick={handleNodeClick} onNodeDoubleClick={handleNodeDoubleClick}
              onEdgeClick={handleEdgeClick} onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onNodeContextMenu={handleNodeContextMenu as any}
              onEdgeContextMenu={handleEdgeContextMenu as any}
              onPaneContextMenu={handlePaneContextMenu as any}
              onSelectionChange={handleSelectionChange}
              fitView minZoom={0.1} maxZoom={3}
              defaultEdgeOptions={{ type: "scenarioEdge" }}
              proOptions={{ hideAttribution: true }}
              style={{ background: "transparent" }}
              deleteKeyCode={null}
              selectionOnDrag selectionMode={"partial" as any} panOnDrag={[1]}
            >
              <Background variant={"dots" as any} gap={24} size={0.8} color="#cbd5e1" />
              <MiniMap nodeColor={miniMapNodeColor} maskColor="rgba(241,245,249,0.7)"
                style={{ bottom: 14, right: 14, width: 180, height: 110, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                pannable zoomable />
              <Controls position="bottom-left" showInteractive={false}
                style={{ borderRadius: 10, border: "1px solid #e2e8f0", boxShadow: "0 2px 10px rgba(0,0,0,0.09)" }} />
            </ReactFlow>

            <Toolbar onAutoLayout={handleAutoLayout} onFitView={handleFitView} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} />
            <NodeSearch nodes={nodes} onFocus={handleSearchFocus} />
            <Legend />
            <GraphToastContainer toasts={toasts} />

            {saveStatus !== "idle" && (
              <div role="status" aria-live="polite" style={{
                position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
                fontSize: 11, color: saveStatus === "saving" ? "#6b7280" : "#16a34a",
                background: "white", border: `1px solid ${saveStatus === "saving" ? "#e2e8f0" : "#bbf7d0"}`,
                borderRadius: 6, padding: "3px 12px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", zIndex: 20,
              }}>
                {saveStatus === "saving" ? "保存中…" : "✓ 保存完了"}
              </div>
            )}

            {bgClickPos && canEdit && (
              <BackgroundClickForm workId={workId} position={bgClickPos} hasStart={hasStart}
                onCreated={() => { setBgClickPos(null); onDataMutated(); }} onCancel={() => setBgClickPos(null)} />
            )}

            {/* エッジドラッグ → 空白ドロップ → 新規フェーズ作成 */}
            {edgeDrop && canEdit && (
              <EdgeDropCreateForm
                workId={workId} fromPhaseId={edgeDrop.fromPhaseId}
                position={edgeDrop.position}
                onCreated={handleEdgeDropCreated}
                onCancel={() => setEdgeDrop(null)}
                onError={showError}
              />
            )}

            {nodes.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14, pointerEvents: "none", zIndex: 1 }}>
                {canEdit ? "キャンバスをクリックしてフェーズを追加" : "フェーズを追加するとノードが表示されます"}
              </div>
            )}
          </div>

          {/* 右パネル: 単一 */}
          {selectedPhase && !isMultiSelect && (
            <div style={{ width: 300, flexShrink: 0, overflowY: "auto", background: "#fff", borderRadius: "0 14px 14px 0", border: "1px solid #e2e8f0", borderLeft: "none" }}>
              <RightPanel
                phase={selectedPhase} transitions={transitions} phases={phases}
                oaId={oaId} workId={workId} canEdit={canEdit}
                onClose={() => setSelected(null)} onDataMutated={handleDataMutated}
                prefillTargetPhaseId={prefillTargetPhaseId} focusedTransitionId={selectedTransitionId}
                onMutationStart={handleMutationStart}
                onDuplicatePhase={() => handleDuplicatePhase(selectedPhase.id)}
                onError={showError}
              />
            </div>
          )}

          {/* 右パネル: 複数選択 */}
          {isMultiSelect && (
            <div style={{ width: 300, flexShrink: 0, overflowY: "auto", background: "#fff", borderRadius: "0 14px 14px 0", border: "1px solid #e2e8f0", borderLeft: "none", padding: "16px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{multiCount}件選択中</div>
                <button onClick={() => setSelected(null)} aria-label="選択解除" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af" }}>×</button>
              </div>
              {/* 選択フェーズ名一覧 */}
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
                {multiPhaseNames.map((name, i) => (
                  <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {name}</div>
                ))}
                {multiCount > 3 && <div>…他{multiCount - 3}件</div>}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                複数ノードをドラッグで一括移動できます。
              </div>
              {canEdit && (
                <button onClick={() => handleBulkDelete(selected.nodeIds)}
                  style={{ marginTop: 4, width: "100%", fontSize: 11, padding: "7px 12px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                  🗑 {multiCount}件を一括削除
                </button>
              )}
            </div>
          )}
        </div>

        {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      </div>
    </DisplayModeContext.Provider>
    </DirectionContext.Provider>
  );
}

export function NodeGraph(props: NodeGraphProps) {
  return (
    <ReactFlowProvider>
      <NodeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
