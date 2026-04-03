"use client";

// src/app/oas/[id]/works/[workId]/scenario/_node-graph.tsx
// ノードグラフビュー — フェーズ・メッセージをノードとして可視化

import { useEffect, useMemo, useRef, useState } from "react";
import { TLink as Link } from "@/components/TLink";
import type { PhaseWithCounts, TransitionWithPhases, PhaseType, Message } from "@/types";
import type { QuickReplyItem } from "@/types";

// ── サイズ・スペーシング定数 ────────────────────────
const PHASE_W  = 224;
const PHASE_H  = 84;
const MSG_W    = 204;
const MSG_H    = 52;
const COL_W    = 400;   // 列間距離（phase x → next phase x）
const MSG_INDENT = 12;  // メッセージのx方向インデント
const MSG_Y_GAP  = 8;   // フェーズ下端 → 最初のメッセージ上端
const MSG_V_GAP  = 5;   // メッセージ間縦隙間
const GROUP_GAP  = 38;  // 同列内フェーズグループ間縦隙間
const CANVAS_PAD = 40;  // キャンバス原点からの初期オフセット

// ── カラーパレット ──────────────────────────────────
const PHASE_META: Record<PhaseType, { label: string; color: string; bg: string; border: string }> = {
  start:  { label: "開始",         color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  normal: { label: "通常",         color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  ending: { label: "エンディング", color: "#9333ea", bg: "#faf5ff", border: "#e9d5ff" },
};

const MSG_KIND_META: Record<string, { label: string; color: string; border: string }> = {
  start:    { label: "開始",   color: "#16a34a", border: "#bbf7d0" },
  normal:   { label: "通常",   color: "#2563eb", border: "#bfdbfe" },
  response: { label: "応答",   color: "#7c3aed", border: "#e9d5ff" },
  hint:     { label: "ヒント", color: "#d97706", border: "#fde68a" },
  puzzle:   { label: "謎",     color: "#dc2626", border: "#fecaca" },
};

// ── レイアウトデータ型 ──────────────────────────────
interface LayoutNode {
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
}

interface LayoutEdge {
  id:     string;
  fromId: string;
  toId:   string;
  label:  string;
  color:  string;
  border: string;
  kind:   "qr-phase" | "qr-message" | "phase-transition";
}

// ── Props ──────────────────────────────────────────
export interface NodeGraphProps {
  phases:      PhaseWithCounts[];
  transitions: TransitionWithPhases[];
  allMessages: Message[];
  oaId:        string;
  workId:      string;
}

// ── レイアウト計算 ─────────────────────────────────
function computeLayout(
  phases:      PhaseWithCounts[],
  transitions: TransitionWithPhases[],
  allMessages: Message[],
  oaId:        string,
  workId:      string,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  // BFS でフェーズに depth（列番号）を割り当て
  const out: Record<string, string[]> = {};
  transitions.forEach(t => {
    if (!out[t.from_phase_id]) out[t.from_phase_id] = [];
    out[t.from_phase_id].push(t.to_phase_id);
  });

  const depths: Record<string, number> = {};
  const starts = phases.filter(p => p.phase_type === "start").map(p => p.id);
  const queue  = [...starts];
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

  // 同じ depth のフェーズを sort_order 順でグルーピング
  const byDepth: Record<number, PhaseWithCounts[]> = {};
  [...phases]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(p => {
      const d = depths[p.id] ?? 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(p);
    });

  // フェーズごとのメッセージ（sort_order 順）
  const msgsByPhase: Record<string, Message[]> = {};
  allMessages
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(m => {
      if (!m.phase_id) return;
      if (!msgsByPhase[m.phase_id]) msgsByPhase[m.phase_id] = [];
      msgsByPhase[m.phase_id].push(m);
    });

  // ── ノード位置を計算 ──────────────────────────────
  const nodes: LayoutNode[] = [];

  for (const depthStr of Object.keys(byDepth).sort((a, b) => Number(a) - Number(b))) {
    const depth   = Number(depthStr);
    const baseX   = CANVAS_PAD + depth * COL_W;
    let   curY    = CANVAS_PAD;

    for (const phase of byDepth[depth]) {
      const meta = PHASE_META[phase.phase_type] ?? PHASE_META.normal;
      const msgs  = msgsByPhase[phase.id] ?? [];

      // フェーズノード
      nodes.push({
        id:        `phase-${phase.id}`,
        type:      "phase",
        x:         baseX,
        y:         curY,
        width:     PHASE_W,
        height:    PHASE_H,
        label:     phase.name,
        sublabel:  `${msgs.length}件のメッセージ`,
        color:     meta.color,
        bg:        meta.bg,
        border:    meta.border,
        href:      `/oas/${oaId}/works/${workId}/phases/${phase.id}`,
        phaseType: phase.phase_type,
      });

      curY += PHASE_H + MSG_Y_GAP;

      // メッセージノード（フェーズの下に積み上げ）
      msgs.forEach(msg => {
        const km      = MSG_KIND_META[msg.kind] ?? MSG_KIND_META.normal;
        const preview = msg.body
          ? msg.body.slice(0, 24) + (msg.body.length > 24 ? "…" : "")
          : `[${msg.kind}]`;

        nodes.push({
          id:       `msg-${msg.id}`,
          type:     "message",
          x:        baseX + MSG_INDENT,
          y:        curY,
          width:    MSG_W,
          height:   MSG_H,
          label:    preview,
          sublabel: km.label,
          color:    km.color,
          bg:       "#fff",
          border:   km.border,
          href:     `/oas/${oaId}/works/${workId}/messages/${msg.id}`,
        });

        curY += MSG_H + MSG_V_GAP;
      });

      curY += GROUP_GAP;
    }
  }

  // ── エッジを計算 ────────────────────────────────
  const edges: LayoutEdge[] = [];
  const seenIds = new Set<string>();
  const nodeIds = new Set(nodes.map(n => n.id));

  const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
  const transMap: Record<string, Record<string, string>> = {};
  transitions.forEach(t => {
    if (!transMap[t.from_phase_id]) transMap[t.from_phase_id] = {};
    transMap[t.from_phase_id][norm(t.label)] = t.to_phase_id;
  });

  // QR ボタンから生成するエッジ
  allMessages.forEach(msg => {
    const qrs = (msg.quick_replies ?? []) as QuickReplyItem[];
    qrs.forEach((item, i) => {
      if (item.enabled === false) return;

      const lbl    = (item.label ?? `ボタン${i + 1}`).trim();
      const fromId = `msg-${msg.id}`;
      const eid    = `qr-${msg.id}-${i}`;
      if (seenIds.has(eid) || !nodeIds.has(fromId)) return;

      if (item.target_phase_id) {
        const toId = `phase-${item.target_phase_id}`;
        if (nodeIds.has(toId)) {
          seenIds.add(eid);
          edges.push({ id: eid, fromId, toId, label: lbl, color: "#7c3aed", border: "#ddd6fe", kind: "qr-phase" });
        }
      } else if (item.target_type === "message" && item.target_message_id) {
        const toId = `msg-${item.target_message_id}`;
        if (nodeIds.has(toId)) {
          seenIds.add(eid);
          edges.push({ id: eid, fromId, toId, label: lbl, color: "#c2410c", border: "#fed7aa", kind: "qr-message" });
        }
      } else if (item.action !== "hint" && item.action !== "url") {
        // テキスト送信 → 遷移マップで照合
        const textVal     = (item.value?.trim() || item.label).trim();
        const matched     = msg.phase_id ? transMap[msg.phase_id]?.[norm(textVal)] : undefined;
        if (matched) {
          const toId = `phase-${matched}`;
          if (nodeIds.has(toId)) {
            seenIds.add(eid);
            edges.push({ id: eid, fromId, toId, label: lbl, color: "#7c3aed", border: "#ddd6fe", kind: "qr-phase" });
          }
        }
      }
    });
  });

  // 遷移エッジ（フェーズ→フェーズ、破線）
  transitions.forEach(t => {
    const fromId = `phase-${t.from_phase_id}`;
    const toId   = `phase-${t.to_phase_id}`;
    if (nodeIds.has(fromId) && nodeIds.has(toId)) {
      edges.push({
        id:     `trans-${t.id}`,
        fromId, toId,
        label:  t.label,
        color:  "#94a3b8",
        border: "#e2e8f0",
        kind:   "phase-transition",
      });
    }
  });

  return { nodes, edges };
}

// ── NodeGraph コンポーネント ───────────────────────
export function NodeGraph({ phases, transitions, allMessages, oaId, workId }: NodeGraphProps) {
  const { nodes: initialNodes, edges } = useMemo(
    () => computeLayout(phases, transitions, allMessages, oaId, workId),
    [phases, transitions, allMessages, oaId, workId],
  );

  // ── 状態 ──────────────────────────────────────────
  // 位置オーバーライド（ドラッグで変更）
  const [positions, setPositions]   = useState<Record<string, { x: number; y: number }>>({});
  const [pan, setPan]               = useState({ x: CANVAS_PAD, y: CANVAS_PAD });
  const [zoom, setZoom]             = useState(0.85);

  // ドラッグ中のノード
  const [nodeStart, setNodeStart]   = useState<{
    nodeId: string; mx: number; my: number; nx: number; ny: number;
  } | null>(null);

  // パン
  const [panStart, setPanStart]     = useState<{
    mx: number; my: number; px: number; py: number;
  } | null>(null);

  // ⑧ hover 中のノード ID
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // クリックかドラッグかの判定
  const draggedRef  = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ⑥ ドラッグ再描画最適化: rAF スロットル + 最終位置確定用 ref
  const rafRef        = useRef<number | null>(null);
  const pendingPosRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);

  // zoom / pan の最新値を useEffect 外のホイールハンドラで使うため ref に同期
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // フェーズが変わったとき、削除されたノードの位置だけ掃除する（手動ドラッグ位置を保持）
  useEffect(() => {
    const validIds = new Set(initialNodes.map(n => n.id));
    setPositions(prev => {
      const stale = Object.keys(prev).filter(id => !validIds.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach(id => delete next[id]);
      return next;
    });
  }, [initialNodes]);

  // ── ホイールズーム（passive:false 必須） ─────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor  = e.deltaY < 0 ? 1.12 : 0.9;
      const curZ    = zoomRef.current;
      const curP    = panRef.current;
      const newZoom = Math.max(0.15, Math.min(3, curZ * factor));
      const rect    = el.getBoundingClientRect();
      const cx      = e.clientX - rect.left;
      const cy      = e.clientY - rect.top;
      const newPan  = {
        x: cx - (cx - curP.x) * (newZoom / curZ),
        y: cy - (cy - curP.y) * (newZoom / curZ),
      };
      setZoom(newZoom);
      setPan(newPan);
      zoomRef.current = newZoom;
      panRef.current  = newPan;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── ノード位置取得（ドラッグ上書き優先） ──────────
  function getPos(nodeId: string): { x: number; y: number } {
    if (positions[nodeId]) return positions[nodeId];
    const n = initialNodes.find(n => n.id === nodeId);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
  }

  // ── マウスハンドラ ────────────────────────────────
  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    draggedRef.current  = false;
    pendingPosRef.current = null; // 前回の未確定位置をクリア
    const pos = getPos(nodeId);
    setNodeStart({ nodeId, mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y });
  }

  function handleBgMouseDown(e: React.MouseEvent) {
    setPanStart({ mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (nodeStart) {
      const dx = (e.clientX - nodeStart.mx) / zoom;
      const dy = (e.clientY - nodeStart.my) / zoom;
      if (Math.abs(e.clientX - nodeStart.mx) > 6 || Math.abs(e.clientY - nodeStart.my) > 6) {
        draggedRef.current = true;
      }
      const newX = nodeStart.nx + dx;
      const newY = nodeStart.ny + dy;

      // ⑥ 最新座標を ref に記録（mouseup 時の最終確定保存に使う）
      pendingPosRef.current = { nodeId: nodeStart.nodeId, x: newX, y: newY };

      // ⑥ rAF スロットル: 前回の未発火フレームをキャンセルして最新値で上書き
      //    mousemove は 100-200 回/秒 発火するが setPositions は最大 60fps に抑える
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (pendingPosRef.current) {
          const { nodeId, x, y } = pendingPosRef.current;
          setPositions(prev => ({ ...prev, [nodeId]: { x, y } }));
        }
        rafRef.current = null;
      });
    } else if (panStart) {
      setPan({
        x: panStart.px + e.clientX - panStart.mx,
        y: panStart.py + e.clientY - panStart.my,
      });
    }
  }

  function handleMouseUp() {
    // ⑥ 未発火の rAF をキャンセルし、最終位置を同期保存（ドロップ時に座標が確定する）
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (pendingPosRef.current) {
      const { nodeId, x, y } = pendingPosRef.current;
      setPositions(prev => ({ ...prev, [nodeId]: { x, y } }));
      pendingPosRef.current = null;
    }
    setNodeStart(null);
    setPanStart(null);
  }

  // ① マウスがコンテナ外に出てもドラッグ・パンを継続できるよう document 側で mouseup を購読
  useEffect(() => {
    if (!nodeStart && !panStart) return;
    const onDocMouseUp = () => {
      // ⑥ コンテナ外でドロップした場合も最終位置を確定保存
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (pendingPosRef.current) {
        const { nodeId, x, y } = pendingPosRef.current;
        setPositions(prev => ({ ...prev, [nodeId]: { x, y } }));
        pendingPosRef.current = null;
      }
      setNodeStart(null);
      setPanStart(null);
    };
    document.addEventListener("mouseup", onDocMouseUp);
    return () => document.removeEventListener("mouseup", onDocMouseUp);
  }, [nodeStart, panStart]);

  // ── Fit View ────────────────────────────────────
  function handleFitView() {
    if (initialNodes.length === 0) return;
    const allX = initialNodes.map(n => getPos(n.id).x);
    const allY = initialNodes.map(n => getPos(n.id).y);
    const allR = initialNodes.map(n => getPos(n.id).x + n.width);
    const allB = initialNodes.map(n => getPos(n.id).y + n.height);
    const minX = Math.min(...allX), minY = Math.min(...allY);
    const maxX = Math.max(...allR), maxY = Math.max(...allB);
    const cW = containerRef.current?.clientWidth  ?? 800;
    const cH = containerRef.current?.clientHeight ?? 680;
    const fz  = Math.min((cW - 80) / (maxX - minX), (cH - 80) / (maxY - minY), 2.0);
    setZoom(fz);
    setPan({
      x: (cW - (maxX - minX) * fz) / 2 - minX * fz,
      y: (cH - (maxY - minY) * fz) / 2 - minY * fz,
    });
  }

  // ── レンダリング用ノードマップ ────────────────────
  const nodeMap: Record<string, LayoutNode & { x: number; y: number }> = {};
  initialNodes.forEach(n => {
    const pos = getPos(n.id);
    nodeMap[n.id] = { ...n, x: pos.x, y: pos.y };
  });

  const isPanning  = !!panStart;
  const isDragging = !!nodeStart;

  // ── SVG エッジパス計算 ────────────────────────────
  function edgePath(fromNode: LayoutNode & {x:number;y:number}, toNode: LayoutNode & {x:number;y:number}): { d: string; mx: number; my: number } {
    const x1 = fromNode.x + fromNode.width;
    const y1 = fromNode.y + fromNode.height / 2;
    const x2 = toNode.x;
    const y2 = toNode.y + toNode.height / 2;
    const dx = x2 - x1;
    // フォワードエッジ: 水平距離の半分、バックエッジ: より大きな弧
    const cx = dx > 0
      ? Math.max(60, dx * 0.45)
      : Math.max(120, Math.abs(dx) * 0.6);
    const d  = `M ${x1} ${y1} C ${x1 + cx} ${y1} ${x2 - cx} ${y2} ${x2} ${y2}`;
    // ベジェ中点 t=0.5 の近似 (cx が水平の場合は正確)
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return { d, mx, my };
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width:    "100%",
        height:   700,
        overflow: "hidden",
        background: "#f1f5f9",
        border:     "1px solid #e2e8f0",
        borderRadius: 14,
        cursor: isPanning ? "grabbing" : isDragging ? "grabbing" : "grab",
        userSelect: "none",
        touchAction: "none",
      }}
      onMouseDown={handleBgMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ドットグリッド背景 */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        aria-hidden
      >
        <defs>
          <pattern
            id="ng-dots"
            width={24 * zoom} height={24 * zoom}
            patternUnits="userSpaceOnUse"
            x={pan.x % (24 * zoom)} y={pan.y % (24 * zoom)}
          >
            <circle cx={1} cy={1} r={0.8} fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ng-dots)" />
      </svg>

      {/* SVG エッジレイヤー */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
        aria-hidden
      >
        <defs>
          <marker id="ng-arr-purple" markerWidth={10} markerHeight={8} refX={9} refY={4} orient="auto">
            <path d="M0 0 L10 4 L0 8 Z" fill="#7c3aed" fillOpacity={0.85} />
          </marker>
          <marker id="ng-arr-orange" markerWidth={10} markerHeight={8} refX={9} refY={4} orient="auto">
            <path d="M0 0 L10 4 L0 8 Z" fill="#c2410c" fillOpacity={0.85} />
          </marker>
          <marker id="ng-arr-gray" markerWidth={10} markerHeight={8} refX={9} refY={4} orient="auto">
            <path d="M0 0 L10 4 L0 8 Z" fill="#94a3b8" fillOpacity={0.7} />
          </marker>
        </defs>

        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map(edge => {
            const from = nodeMap[edge.fromId];
            const to   = nodeMap[edge.toId];
            if (!from || !to) return null;

            const { d, mx, my } = edgePath(from, to);
            const isTrans = edge.kind === "phase-transition";
            const isMsg   = edge.kind === "qr-message";
            const markerId = isTrans ? "ng-arr-gray" : isMsg ? "ng-arr-orange" : "ng-arr-purple";

            // ラベル文字列（最大12文字）
            const labelText = edge.label.length > 12 ? edge.label.slice(0, 12) + "…" : edge.label;
            // ラベル幅を文字数から推定（CJK考慮で1文字約8px、余白16px）
            const labelW = Math.min(120, Math.max(40, labelText.length * 8 + 16));

            return (
              <g key={edge.id}>
                {/* パス */}
                <path
                  d={d}
                  fill="none"
                  stroke={edge.color}
                  strokeWidth={isTrans ? 1.2 : 1.8}
                  strokeDasharray={isTrans ? "5 3" : undefined}
                  strokeOpacity={isTrans ? 0.45 : 0.8}
                  markerEnd={`url(#${markerId})`}
                />
                {/* ラベル背景 */}
                <rect
                  x={mx - labelW / 2}
                  y={my - 10}
                  width={labelW}
                  height={20}
                  rx={5}
                  fill="white"
                  stroke={edge.border}
                  strokeWidth={1}
                  fillOpacity={0.95}
                />
                {/* ラベルテキスト */}
                <text
                  x={mx}
                  y={my + 5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={edge.color}
                >
                  {labelText}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* HTMLノードレイヤー */}
      {initialNodes.map(initNode => {
        const node     = nodeMap[initNode.id];
        const isDrag   = nodeStart?.nodeId === node.id;
        // ⑧ ドラッグ中（自ノード問わず）はバッジを非表示にする
        const isHovered = hoveredNodeId === node.id && !nodeStart;

        const screenL = pan.x + node.x * zoom;
        const screenT = pan.y + node.y * zoom;
        const screenW = node.width  * zoom;
        const screenH = node.height * zoom;

        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left:     screenL,
              top:      screenT,
              width:    screenW,
              height:   screenH,
              zIndex:   isDrag ? 20 : isHovered ? 10 : node.type === "phase" ? 5 : 3,
              cursor:   isDrag ? "grabbing" : "grab",
            }}
            onMouseDown={e => handleNodeMouseDown(e, node.id)}
            onMouseEnter={() => setHoveredNodeId(node.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
          >
            {/* ズームに合わせて内部をスケール */}
            <div style={{
              width:           node.width,
              height:          node.height,
              transform:       `scale(${zoom})`,
              transformOrigin: "top left",
              boxSizing:       "border-box",
            }}>
              <Link
                href={node.href}
                style={{ textDecoration: "none", display: "block", height: "100%" }}
                onClick={e => { if (draggedRef.current) e.preventDefault(); }}
              >
                {node.type === "phase" ? (
                  <PhaseNodeCard node={node} isDragging={isDrag} />
                ) : (
                  <MessageNodeCard node={node} isDragging={isDrag} />
                )}
              </Link>
            </div>

            {/* ⑧ hover 時の編集バッジ（scaling div の外 = screen 座標で常に読みやすいサイズ）*/}
            {isHovered && (
              <a
                href={node.href}
                style={{
                  position:       "absolute",
                  top:            5,
                  right:          5,
                  fontSize:       10,
                  fontWeight:     700,
                  background:     node.color,
                  color:          "white",
                  padding:        "2px 8px",
                  borderRadius:   4,
                  textDecoration: "none",
                  lineHeight:     "16px",
                  whiteSpace:     "nowrap",
                  boxShadow:      "0 1px 4px rgba(0,0,0,0.22)",
                  pointerEvents:  "auto",
                }}
                onMouseDown={e => e.stopPropagation()} // ドラッグ誤起動を防ぐ
              >
                ✏ 編集
              </a>
            )}
          </div>
        );
      })}

      {/* ── コントロール ── */}
      <div style={{
        position: "absolute", bottom: 14, right: 14,
        display: "flex", flexDirection: "column",
        background: "white", border: "1px solid #e2e8f0",
        borderRadius: 10, overflow: "hidden",
        boxShadow: "0 2px 10px rgba(0,0,0,0.09)",
      }}>
        {([
          { label: "+", title: "ズームイン",   action: () => setZoom(z => Math.min(3, z * 1.18)) },
          { label: "−", title: "ズームアウト", action: () => setZoom(z => Math.max(0.15, z / 1.18)) },
          { label: "⊡", title: "全体を表示",   action: handleFitView },
          { label: "↺", title: "リセット",     action: () => { setZoom(0.85); setPan({ x: CANVAS_PAD, y: CANVAS_PAD }); setPositions({}); } },
        ] as const).map(({ label, title, action }) => (
          <button
            key={label}
            onClick={action}
            title={title}
            style={{
              width: 40, height: 40,
              fontSize: 18, fontWeight: 700,
              border: "none",
              borderBottom: label !== "↺" ? "1px solid #f1f5f9" : "none",
              background: "transparent",
              cursor: "pointer",
              color: "#475569",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ズーム表示 */}
      <div style={{
        position: "absolute", bottom: 14, left: 14,
        fontSize: 11, color: "#94a3b8",
        background: "white", border: "1px solid #e2e8f0",
        borderRadius: 6, padding: "3px 9px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}>
        {Math.round(zoom * 100)}%
      </div>

      {/* 凡例 */}
      <div style={{
        position: "absolute", top: 14, right: 14,
        background: "white", border: "1px solid #e2e8f0",
        borderRadius: 8, padding: "8px 12px",
        fontSize: 10, color: "#6b7280",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        <LegendRow color="#7c3aed" dash={false} label="QR → フェーズ遷移" />
        <LegendRow color="#c2410c" dash={false} label="QR → メッセージ遷移" />
        <LegendRow color="#94a3b8" dash         label="遷移設定（構造）" />
      </div>

      {/* ノードが0件のときの空状態 */}
      {initialNodes.length === 0 && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#94a3b8", fontSize: 14,
        }}>
          フェーズを追加するとノードが表示されます
        </div>
      )}
    </div>
  );
}

// ── フェーズノードカード ──────────────────────────
function PhaseNodeCard({ node, isDragging }: { node: LayoutNode; isDragging: boolean }) {
  const meta = node.phaseType ? (PHASE_META[node.phaseType] ?? PHASE_META.normal) : PHASE_META.normal;
  return (
    <div style={{
      width: "100%", height: "100%",
      background:   node.bg,
      border:       `2px solid ${node.border}`,
      borderLeft:   `5px solid ${node.color}`,
      borderRadius: 10,
      padding:      "9px 12px",
      boxSizing:    "border-box",
      display:      "flex", flexDirection: "column", justifyContent: "center",
      boxShadow:    isDragging
        ? "0 10px 32px rgba(0,0,0,0.16)"
        : "0 2px 10px rgba(0,0,0,0.08)",
      transition:   "box-shadow 0.15s",
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: meta.color, letterSpacing: "0.06em", marginBottom: 4 }}>
        {meta.label}
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700, color: "#111827",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        lineHeight: 1.3,
      }}>
        {node.label}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
        {node.sublabel}
      </div>
    </div>
  );
}

// ── メッセージノードカード ────────────────────────
function MessageNodeCard({ node, isDragging }: { node: LayoutNode; isDragging: boolean }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      background:   "#fff",
      border:       `1.5px solid ${node.border}`,
      borderLeft:   `3.5px solid ${node.color}`,
      borderRadius: 8,
      padding:      "6px 10px",
      boxSizing:    "border-box",
      display:      "flex", flexDirection: "column", justifyContent: "center",
      boxShadow:    isDragging
        ? "0 8px 24px rgba(0,0,0,0.12)"
        : "0 1px 4px rgba(0,0,0,0.06)",
      transition:   "box-shadow 0.15s",
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: node.color, letterSpacing: "0.04em", marginBottom: 3 }}>
        {node.sublabel}
      </div>
      <div style={{
        fontSize: 12, color: "#374151",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        lineHeight: 1.3,
      }}>
        {node.label}
      </div>
    </div>
  );
}

// ── 凡例行 ─────────────────────────────────────────
function LegendRow({ color, dash, label }: { color: string; dash: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <svg width={24} height={10} style={{ flexShrink: 0 }}>
        <line
          x1={0} y1={5} x2={24} y2={5}
          stroke={color} strokeWidth={2}
          strokeDasharray={dash ? "4 2" : undefined}
          strokeOpacity={dash ? 0.6 : 0.9}
        />
        <polygon points="20,2 24,5 20,8" fill={color} fillOpacity={dash ? 0.6 : 0.9} />
      </svg>
      <span style={{ fontSize: 10, color: "#6b7280" }}>{label}</span>
    </div>
  );
}
