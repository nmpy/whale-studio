"use client";

// src/app/oas/[id]/works/[workId]/scenario/_node-graph.tsx
// ノードグラフビュー — フェーズ・メッセージをノードとして可視化

import { useEffect, useMemo, useRef, useState } from "react";
import { TLink as Link } from "@/components/TLink";
import type {
  PhaseWithCounts,
  TransitionWithPhases,
  PhaseType,
  Message,
  CreateTransitionBody,
  UpdateTransitionBody,
} from "@/types";
import type { QuickReplyItem } from "@/types";
import { transitionApi, phaseApi, getDevToken } from "@/lib/api-client";

// ── サイズ・スペーシング定数 ────────────────────────
const PHASE_W    = 224;
const PHASE_H    = 84;
const MSG_W      = 204;
const MSG_H      = 52;
const COL_W      = 400;
const MSG_INDENT = 12;
const MSG_Y_GAP  = 8;
const MSG_V_GAP  = 5;
const GROUP_GAP  = 38;
const CANVAS_PAD = 40;

// ── カラーパレット ──────────────────────────────────
const PHASE_META: Record<PhaseType, { label: string; color: string; bg: string; border: string }> = {
  start:  { label: "開始",           color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  normal: { label: "通常",           color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  ending: { label: "エンディング",   color: "#dc2626", bg: "#fff1f2", border: "#fecaca" },
  global: { label: "全フェーズ共通", color: "#b45309", bg: "#fffbeb", border: "#fcd34d" },
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
  phaseId?:  string;
}

interface LayoutEdge {
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

// ── Props ──────────────────────────────────────────
export interface NodeGraphProps {
  phases:        PhaseWithCounts[];
  transitions:   TransitionWithPhases[];
  allMessages:   Message[];
  oaId:          string;
  workId:        string;
  canEdit?:      boolean;
  onDataMutated: () => void;
}

// ── グラフ分析 ─────────────────────────────────────
interface GraphAnalysis {
  reachablePhaseIds:  Set<string>;
  hasEndingReachable: boolean;
  loopTransitionIds:  Set<string>;
}

function analyzeGraph(phases: PhaseWithCounts[], transitions: TransitionWithPhases[]): GraphAnalysis {
  // 1. BFS from start phases
  const starts = phases.filter(p => p.phase_type === "start").map(p => p.id);
  const reachable = new Set<string>(starts);
  const queue = [...starts];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const t of transitions) {
      if (t.from_phase_id === id && !reachable.has(t.to_phase_id)) {
        reachable.add(t.to_phase_id);
        queue.push(t.to_phase_id);
      }
    }
  }
  const hasEndingReachable = phases.filter(p => p.phase_type === "ending").some(p => reachable.has(p.id));

  // 2. DFS loop detection (back-edges)
  const loopTransitionIds = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adj: Record<string, Array<{ id: string; tid: string }>> = {};
  for (const t of transitions) {
    if (!adj[t.from_phase_id]) adj[t.from_phase_id] = [];
    adj[t.from_phase_id].push({ id: t.to_phase_id, tid: t.id });
  }
  function dfs(nodeId: string) {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const { id: nextId, tid } of adj[nodeId] ?? []) {
      if (!visited.has(nextId)) dfs(nextId);
      else if (inStack.has(nextId)) loopTransitionIds.add(tid);
    }
    inStack.delete(nodeId);
  }
  for (const p of phases) {
    if (!visited.has(p.id)) dfs(p.id);
  }

  return { reachablePhaseIds: reachable, hasEndingReachable, loopTransitionIds };
}

// ── パス検索（逆BFS）──────────────────────────────
function getAncestorPath(
  targetPhaseId: string,
  transitions: TransitionWithPhases[],
): { pathPhaseIds: Set<string>; pathTransitionIds: Set<string> } {
  const reverse: Record<string, Array<{ fromId: string; tid: string }>> = {};
  for (const t of transitions) {
    if (!reverse[t.to_phase_id]) reverse[t.to_phase_id] = [];
    reverse[t.to_phase_id].push({ fromId: t.from_phase_id, tid: t.id });
  }
  const inPath = new Set<string>([targetPhaseId]);
  const pathTids = new Set<string>();
  const queue = [targetPhaseId];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const { fromId, tid } of reverse[id] ?? []) {
      pathTids.add(tid);
      if (!inPath.has(fromId)) {
        inPath.add(fromId);
        queue.push(fromId);
      }
    }
  }
  return { pathPhaseIds: inPath, pathTransitionIds: pathTids };
}

// ── エッジバッジ計算 ───────────────────────────────
function getEdgeBadge(edge: LayoutEdge): { text: string; bg: string; color: string; borderColor: string } {
  if (edge.kind !== "phase-transition") {
    const lbl = edge.label.length > 10 ? edge.label.slice(0, 10) + "…" : edge.label;
    return { text: lbl, bg: "#f5f3ff", color: "#7c3aed", borderColor: "#ddd6fe" };
  }
  if (edge.condition) {
    const c = edge.condition.length > 8 ? edge.condition.slice(0, 8) + "…" : edge.condition;
    return { text: `🔑 ${c}`, bg: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" };
  }
  if (edge.flagCondition) {
    return { text: "フラグ条件", bg: "#f5f3ff", color: "#6d28d9", borderColor: "#e9d5ff" };
  }
  const lower = edge.label.toLowerCase();
  if (lower.includes("正解") && !lower.includes("不正解"))
    return { text: "✓ 正解", bg: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" };
  if (lower.includes("不正解"))
    return { text: "✗ 不正解", bg: "#fef2f2", color: "#dc2626", borderColor: "#fecaca" };
  return { text: "デフォルト", bg: "#f9fafb", color: "#6b7280", borderColor: "#e5e7eb" };
}

// ── レイアウト計算 ─────────────────────────────────
function computeLayout(
  phases:      PhaseWithCounts[],
  transitions: TransitionWithPhases[],
  allMessages: Message[],
  oaId:        string,
  workId:      string,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
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

  const byDepth: Record<number, PhaseWithCounts[]> = {};
  [...phases]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(p => {
      const d = depths[p.id] ?? 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(p);
    });

  const msgsByPhase: Record<string, Message[]> = {};
  allMessages
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(m => {
      if (!m.phase_id) return;
      if (!msgsByPhase[m.phase_id]) msgsByPhase[m.phase_id] = [];
      msgsByPhase[m.phase_id].push(m);
    });

  const nodes: LayoutNode[] = [];

  for (const depthStr of Object.keys(byDepth).sort((a, b) => Number(a) - Number(b))) {
    const depth  = Number(depthStr);
    const baseX  = CANVAS_PAD + depth * COL_W;
    let   curY   = CANVAS_PAD;

    for (const phase of byDepth[depth]) {
      const meta = PHASE_META[phase.phase_type] ?? PHASE_META.normal;
      const msgs = msgsByPhase[phase.id] ?? [];

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
        phaseId:   phase.id,
      });

      curY += PHASE_H + MSG_Y_GAP;

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

  const edges: LayoutEdge[] = [];
  const seenIds = new Set<string>();
  const nodeIds = new Set(nodes.map(n => n.id));

  const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
  const transMap: Record<string, Record<string, string>> = {};
  transitions.forEach(t => {
    if (!transMap[t.from_phase_id]) transMap[t.from_phase_id] = {};
    transMap[t.from_phase_id][norm(t.label)] = t.to_phase_id;
  });

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
          edges.push({ id: eid, fromId, toId, label: lbl, color: "#7c3aed", border: "#ddd6fe", kind: "qr-phase", isDefault: false });
        }
      } else if (item.target_type === "message" && item.target_message_id) {
        const toId = `msg-${item.target_message_id}`;
        if (nodeIds.has(toId)) {
          seenIds.add(eid);
          edges.push({ id: eid, fromId, toId, label: lbl, color: "#c2410c", border: "#fed7aa", kind: "qr-message", isDefault: false });
        }
      } else if (item.action !== "hint" && item.action !== "url") {
        const textVal = (item.value?.trim() || item.label).trim();
        const matched = msg.phase_id ? transMap[msg.phase_id]?.[norm(textVal)] : undefined;
        if (matched) {
          const toId = `phase-${matched}`;
          if (nodeIds.has(toId)) {
            seenIds.add(eid);
            edges.push({ id: eid, fromId, toId, label: lbl, color: "#7c3aed", border: "#ddd6fe", kind: "qr-phase", isDefault: false });
          }
        }
      }
    });
  });

  transitions.forEach(t => {
    const fromId = `phase-${t.from_phase_id}`;
    const toId   = `phase-${t.to_phase_id}`;
    if (nodeIds.has(fromId) && nodeIds.has(toId)) {
      const hasCondition = !!(t.condition || t.flag_condition);
      edges.push({
        id:            `trans-${t.id}`,
        fromId, toId,
        label:         t.label,
        color:         "#94a3b8",
        border:        "#e2e8f0",
        kind:          "phase-transition",
        condition:     t.condition,
        flagCondition: t.flag_condition,
        isDefault:     !hasCondition,
        transitionId:  t.id,
      });
    }
  });

  return { nodes, edges };
}

// ── RightPanel コンポーネント ─────────────────────
function RightPanel({
  phase,
  transitions,
  phases,
  oaId,
  workId,
  canEdit,
  onClose,
  onDataMutated,
  prefillTargetPhaseId,
  focusedTransitionId,
  onMutationStart,
}: {
  phase: PhaseWithCounts;
  transitions: TransitionWithPhases[];
  phases: PhaseWithCounts[];
  oaId: string;
  workId: string;
  canEdit: boolean;
  onClose: () => void;
  onDataMutated: () => void;
  prefillTargetPhaseId?: string | null;
  focusedTransitionId?: string | null;
  onMutationStart?: () => void;
}) {
  const outgoing = transitions.filter(t => t.from_phase_id === phase.id);
  const meta = PHASE_META[phase.phase_type] ?? PHASE_META.normal;

  // 新規遷移追加フォームの状態
  const [addOpen, setAddOpen]           = useState(!!prefillTargetPhaseId);
  const [addLabel, setAddLabel]         = useState("");
  const [addToPhaseId, setAddToPhaseId] = useState(prefillTargetPhaseId ?? "");
  const [addCondition, setAddCondition] = useState("");
  const [addFlagCond, setAddFlagCond]   = useState("");
  const [addShowCond, setAddShowCond]   = useState(false);
  const [addSaving, setAddSaving]       = useState(false);

  // 編集中の遷移
  const [editingTid, setEditingTid]       = useState<string | null>(null);
  const [editToPhaseId, setEditToPhaseId] = useState("");
  const [editLabel, setEditLabel]         = useState("");
  const [editSaving, setEditSaving]       = useState(false);

  // 削除中
  const [deletingTid, setDeletingTid] = useState<string | null>(null);

  async function handleAddTransition() {
    if (!addToPhaseId || !addLabel.trim()) return;
    onMutationStart?.();
    setAddSaving(true);
    try {
      const body: CreateTransitionBody = {
        work_id:      workId,
        from_phase_id: phase.id,
        to_phase_id:   addToPhaseId,
        label:         addLabel.trim(),
      };
      if (addCondition.trim()) body.condition = addCondition.trim();
      if (addFlagCond.trim())  body.flag_condition = addFlagCond.trim();
      await transitionApi.create(getDevToken(), body);
      setAddLabel(""); setAddToPhaseId(""); setAddCondition(""); setAddFlagCond("");
      setAddOpen(false);
      onDataMutated();
    } catch (err) {
      console.error(err);
    } finally {
      setAddSaving(false);
    }
  }

  function startEdit(t: TransitionWithPhases) {
    setEditingTid(t.id);
    setEditToPhaseId(t.to_phase_id);
    setEditLabel(t.label);
  }

  async function handleSaveEdit(tid: string) {
    if (!editToPhaseId || !editLabel.trim()) return;
    onMutationStart?.();
    setEditSaving(true);
    try {
      const body: UpdateTransitionBody = { to_phase_id: editToPhaseId, label: editLabel.trim() };
      await transitionApi.update(getDevToken(), tid, body);
      setEditingTid(null);
      onDataMutated();
    } catch (err) {
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(tid: string) {
    if (!confirm("この遷移を削除しますか？")) return;
    onMutationStart?.();
    setDeletingTid(tid);
    try {
      await transitionApi.delete(getDevToken(), tid);
      onDataMutated();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingTid(null);
    }
  }

  const otherPhases = phases.filter(p => p.id !== phase.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ヘッダー */}
      <div style={{
        padding: "12px 14px",
        borderBottom: "1px solid #e5e7eb",
        display: "flex", alignItems: "flex-start", gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: meta.color,
              background: meta.bg, border: `1px solid ${meta.border}`,
              borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap",
            }}>
              {meta.label}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", wordBreak: "break-all" }}>
            {phase.name}
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <Link
              href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
              style={{
                fontSize: 11, color: "#2563eb", textDecoration: "none",
                border: "1px solid #bfdbfe", borderRadius: 4,
                padding: "2px 8px", background: "#eff6ff",
              }}
            >
              ✏ フェーズ編集
            </Link>
            <Link
              href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
              style={{
                fontSize: 11, color: "#6b7280", textDecoration: "none",
                border: "1px solid #e5e7eb", borderRadius: 4,
                padding: "2px 8px", background: "#f9fafb",
              }}
            >
              💬 メッセージ
            </Link>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 16, color: "#9ca3af", padding: 4,
            borderRadius: 4, lineHeight: 1, flexShrink: 0,
          }}
          title="閉じる"
        >
          ✕
        </button>
      </div>

      {/* 遷移一覧 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 8, letterSpacing: "0.05em" }}>
          遷移 ({outgoing.length})
        </div>

        {outgoing.length === 0 && (
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>
            遷移が設定されていません
          </div>
        )}

        {outgoing.map(t => {
          const isEditing  = editingTid === t.id;
          const isDeleting = deletingTid === t.id;
          const isFocused  = focusedTransitionId === t.id;
          const targetPhaseMeta = phases.find(p => p.id === t.to_phase_id);
          const tMeta = targetPhaseMeta ? (PHASE_META[targetPhaseMeta.phase_type] ?? PHASE_META.normal) : null;

          return (
            <div
              key={t.id}
              style={{
                border:       isFocused ? "2px solid #2563eb" : "1px solid #e5e7eb",
                borderRadius: 8,
                padding:      "8px 10px",
                marginBottom: 8,
                background:   isFocused ? "#eff6ff" : "#fafafa",
                opacity:      isDeleting ? 0.5 : 1,
                boxShadow:    isFocused ? "0 0 0 3px rgba(37,99,235,0.15)" : "none",
                transition:   "border-color 0.15s, background 0.15s",
              }}
            >
              {isEditing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    placeholder="ラベル"
                    style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 8px" }}
                  />
                  <select
                    value={editToPhaseId}
                    onChange={e => setEditToPhaseId(e.target.value)}
                    style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 6px" }}
                  >
                    <option value="">遷移先を選択</option>
                    {otherPhases.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleSaveEdit(t.id)}
                      disabled={editSaving || !editToPhaseId || !editLabel.trim()}
                      style={{
                        fontSize: 11, padding: "4px 10px",
                        background: "#2563eb", color: "white",
                        border: "none", borderRadius: 4, cursor: "pointer",
                      }}
                    >
                      {editSaving ? "保存中…" : "保存"}
                    </button>
                    <button
                      onClick={() => setEditingTid(null)}
                      style={{
                        fontSize: 11, padding: "4px 10px",
                        background: "#f3f4f6", color: "#374151",
                        border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
                      }}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#111827", flex: 1 }}>{t.label}</span>
                    {canEdit && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => startEdit(t)}
                          style={{
                            fontSize: 10, padding: "2px 7px",
                            background: "#eff6ff", color: "#2563eb",
                            border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer",
                          }}
                        >編集</button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={isDeleting}
                          style={{
                            fontSize: 10, padding: "2px 7px",
                            background: "#fff1f2", color: "#dc2626",
                            border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer",
                          }}
                        >削除</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6b7280" }}>
                    <span>→</span>
                    {tMeta && (
                      <span style={{ color: tMeta.color, fontWeight: 600 }}>
                        {targetPhaseMeta?.name ?? t.to_phase_id}
                      </span>
                    )}
                  </div>
                  {(t.condition || t.flag_condition) && (
                    <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {t.condition && (
                        <span style={{ fontSize: 10, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 3, padding: "1px 5px" }}>
                          🔑 {t.condition}
                        </span>
                      )}
                      {t.flag_condition && (
                        <span style={{ fontSize: 10, background: "#f5f3ff", color: "#6d28d9", border: "1px solid #e9d5ff", borderRadius: 3, padding: "1px 5px" }}>
                          ⚑ {t.flag_condition}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* 追加フォーム */}
        {canEdit && (
          <div style={{ marginTop: 4 }}>
            {!addOpen ? (
              <button
                onClick={() => setAddOpen(true)}
                style={{
                  width: "100%", fontSize: 12, padding: "7px",
                  background: "#f0fdf4", color: "#16a34a",
                  border: "1.5px dashed #bbf7d0", borderRadius: 6,
                  cursor: "pointer", fontWeight: 600,
                }}
              >
                ＋ 遷移を追加
              </button>
            ) : (
              <div style={{
                border: "1px solid #d1d5db", borderRadius: 8,
                padding: "10px 10px", background: "#fff",
                display: "flex", flexDirection: "column", gap: 7,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 2 }}>遷移を追加</div>
                <input
                  value={addLabel}
                  onChange={e => setAddLabel(e.target.value)}
                  placeholder="ラベル（必須）"
                  style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
                />
                <select
                  value={addToPhaseId}
                  onChange={e => setAddToPhaseId(e.target.value)}
                  style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 6px" }}
                >
                  <option value="">遷移先フェーズを選択（必須）</option>
                  {otherPhases.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <button
                  onClick={() => setAddShowCond(v => !v)}
                  style={{
                    fontSize: 10, padding: "2px 8px",
                    background: "none", color: "#6b7280",
                    border: "1px solid #e5e7eb", borderRadius: 4, cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  {addShowCond ? "▲ 条件を非表示" : "▼ 条件を追加（任意）"}
                </button>

                {addShowCond && (
                  <>
                    <input
                      value={addCondition}
                      onChange={e => setAddCondition(e.target.value)}
                      placeholder="条件（テキスト）"
                      style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
                    />
                    <input
                      value={addFlagCond}
                      onChange={e => setAddFlagCond(e.target.value)}
                      placeholder="フラグ条件（例: flags.score >= 10）"
                      style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
                    />
                  </>
                )}

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleAddTransition}
                    disabled={addSaving || !addToPhaseId || !addLabel.trim()}
                    style={{
                      fontSize: 11, padding: "5px 12px",
                      background: "#2563eb", color: "white",
                      border: "none", borderRadius: 4, cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {addSaving ? "追加中…" : "追加"}
                  </button>
                  <button
                    onClick={() => { setAddOpen(false); setAddLabel(""); setAddToPhaseId(""); setAddCondition(""); setAddFlagCond(""); setAddShowCond(false); }}
                    style={{
                      fontSize: 11, padding: "5px 10px",
                      background: "#f3f4f6", color: "#374151",
                      border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
                    }}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── NodeGraph コンポーネント ───────────────────────
export function NodeGraph({
  phases,
  transitions,
  allMessages,
  oaId,
  workId,
  canEdit = false,
  onDataMutated,
}: NodeGraphProps) {
  const { nodes: initialNodes, edges } = useMemo(
    () => computeLayout(phases, transitions, allMessages, oaId, workId),
    [phases, transitions, allMessages, oaId, workId],
  );

  // グラフ分析
  const graphAnalysis = useMemo(
    () => analyzeGraph(phases, transitions),
    [phases, transitions],
  );
  const { reachablePhaseIds, hasEndingReachable, loopTransitionIds } = graphAnalysis;

  // フェーズ別メッセージ（プレビュー用）
  const msgsByPhase = useMemo(() => {
    const map: Record<string, Message[]> = {};
    [...allMessages]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .forEach(m => {
        if (!m.phase_id) return;
        if (!map[m.phase_id]) map[m.phase_id] = [];
        map[m.phase_id].push(m);
      });
    return map;
  }, [allMessages]);

  // 選択フェーズへのパス
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const ancestorPath = useMemo(() => {
    if (!selectedPhaseId) return null;
    return getAncestorPath(selectedPhaseId, transitions);
  }, [selectedPhaseId, transitions]);

  // 位置オーバーライド
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

  // hover 状態
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // ドラッグ接続
  const [connectDrag, setConnectDrag] = useState<{
    fromPhaseId: string;
    startX: number; startY: number;
    curX: number; curY: number;
    targetPhaseId: string | null;
  } | null>(null);

  // バックグラウンドクリックでフェーズ追加
  const [bgClickPos, setBgClickPos] = useState<{ x: number; y: number } | null>(null);
  const [bgFormName, setBgFormName] = useState("");
  const [bgFormType, setBgFormType] = useState<PhaseType>("normal");
  const [bgFormSaving, setBgFormSaving] = useState(false);

  // 接続ドラッグ後のプリフィル
  const [prefillTargetPhaseId, setPrefillTargetPhaseId] = useState<string | null>(null);

  // ① ノードプレビュー（300ms 遅延）
  const [previewPhaseId, setPreviewPhaseId]   = useState<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ② 保存状態表示
  const [saveStatus, setSaveStatus]           = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ③ 選択エッジ（クリック直接編集）
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);

  // クリックかドラッグかの判定
  const draggedRef   = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgMouseDownPos = useRef<{ x: number; y: number } | null>(null);

  // rAF スロットル
  const rafRef        = useRef<number | null>(null);
  const pendingPosRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);

  // zoom/pan を ref にも同期
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // タイマークリーンアップ
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (saveTimerRef.current)    clearTimeout(saveTimerRef.current);
    };
  }, []);

  // 削除されたノードの位置を掃除
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

  // ホイールズーム
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

  // ノード位置取得
  function getPos(nodeId: string): { x: number; y: number } {
    if (positions[nodeId]) return positions[nodeId];
    const n = initialNodes.find(nd => nd.id === nodeId);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
  }

  // ── マウスハンドラ ────────────────────────────────
  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    draggedRef.current  = false;
    pendingPosRef.current = null;
    const pos = getPos(nodeId);
    setNodeStart({ nodeId, mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y });
  }

  function handleBgMouseDown(e: React.MouseEvent) {
    // connectDrag 中ならバックグラウンドパン無効
    if (connectDrag) return;
    setPanStart({ mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y });
    bgMouseDownPos.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseMove(e: React.MouseEvent) {
    // 接続ドラッグ中
    if (connectDrag) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // ターゲットフェーズ検出
      let targetPhaseId: string | null = null;
      for (const nd of initialNodes) {
        if (nd.type !== "phase" || !nd.phaseId || nd.phaseId === connectDrag.fromPhaseId) continue;
        const pos = getPos(nd.id);
        const sl = pan.x + pos.x * zoom;
        const st = pan.y + pos.y * zoom;
        const sw = nd.width * zoom;
        const sh = nd.height * zoom;
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        if (cx >= sl && cx <= sl + sw && cy >= st && cy <= st + sh) {
          targetPhaseId = nd.phaseId;
          break;
        }
      }
      setConnectDrag(prev => prev ? { ...prev, curX: e.clientX - rect.left, curY: e.clientY - rect.top, targetPhaseId } : null);
      return;
    }

    if (nodeStart) {
      const dx = (e.clientX - nodeStart.mx) / zoom;
      const dy = (e.clientY - nodeStart.my) / zoom;
      if (Math.abs(e.clientX - nodeStart.mx) > 6 || Math.abs(e.clientY - nodeStart.my) > 6) {
        draggedRef.current = true;
      }
      const newX = nodeStart.nx + dx;
      const newY = nodeStart.ny + dy;

      pendingPosRef.current = { nodeId: nodeStart.nodeId, x: newX, y: newY };

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

  function handleMouseUp(e: React.MouseEvent) {
    // 接続ドラッグ終了
    if (connectDrag) {
      if (connectDrag.targetPhaseId && connectDrag.targetPhaseId !== connectDrag.fromPhaseId) {
        // ターゲット確定 → RightPanelで追加フォームをプリフィル
        const fromPhase = phases.find(p => p.id === connectDrag.fromPhaseId);
        if (fromPhase) {
          setSelectedPhaseId(connectDrag.fromPhaseId);
          setPrefillTargetPhaseId(connectDrag.targetPhaseId);
        }
      }
      setConnectDrag(null);
      return;
    }

    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (pendingPosRef.current) {
      const { nodeId, x, y } = pendingPosRef.current;
      setPositions(prev => ({ ...prev, [nodeId]: { x, y } }));
      pendingPosRef.current = null;
    }
    setNodeStart(null);
    setPanStart(null);
  }

  function handleBgMouseUp(e: React.MouseEvent) {
    handleMouseUp(e);
    // 背景クリック（ドラッグなし）でフォーム表示
    if (!draggedRef.current && !connectDrag && bgMouseDownPos.current) {
      const dx = Math.abs(e.clientX - bgMouseDownPos.current.x);
      const dy = Math.abs(e.clientY - bgMouseDownPos.current.y);
      if (dx < 5 && dy < 5) {
        // キャンバス座標に変換
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const cx = (e.clientX - rect.left - pan.x) / zoom;
          const cy = (e.clientY - rect.top  - pan.y) / zoom;
          setBgClickPos({ x: cx, y: cy });
        }
        setSelectedPhaseId(null);
      }
    }
    bgMouseDownPos.current = null;
    draggedRef.current = false;
  }

  // コンテナ外でのマウスアップ
  useEffect(() => {
    if (!nodeStart && !panStart && !connectDrag) return;
    const onDocMouseUp = () => {
      if (connectDrag) { setConnectDrag(null); return; }
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
  }, [nodeStart, panStart, connectDrag]);

  // ── Fit View ──────────────────────────────────────
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

  // ── 保存状態ハンドラ ──────────────────────────────
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

  // ── オートレイアウト ───────────────────────────────
  function handleAutoLayout() {
    setPositions({});
    // positions リセット後に fitView
    setTimeout(() => {
      const allX = initialNodes.map(n => n.x);
      const allY = initialNodes.map(n => n.y);
      const allR = initialNodes.map(n => n.x + n.width);
      const allB = initialNodes.map(n => n.y + n.height);
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
    }, 30);
  }

  // ── バックグラウンドクリックでフェーズ作成 ────────
  async function handleCreatePhase() {
    if (!bgFormName.trim()) return;
    setBgFormSaving(true);
    try {
      await phaseApi.create(getDevToken(), {
        work_id:    workId,
        name:       bgFormName.trim(),
        phase_type: bgFormType,
      });
      setBgClickPos(null);
      setBgFormName("");
      setBgFormType("normal");
      onDataMutated();
    } catch (err) {
      console.error(err);
    } finally {
      setBgFormSaving(false);
    }
  }

  // ── レンダリング用ノードマップ ────────────────────
  const nodeMap: Record<string, LayoutNode & { x: number; y: number }> = {};
  initialNodes.forEach(n => {
    const pos = getPos(n.id);
    nodeMap[n.id] = { ...n, x: pos.x, y: pos.y };
  });

  const isPanning  = !!panStart;
  const isDragging = !!nodeStart;

  // ── SVG エッジパス計算 ─────────────────────────
  function edgePath(
    fromNode: LayoutNode & { x: number; y: number },
    toNode:   LayoutNode & { x: number; y: number },
  ): { d: string; mx: number; my: number } {
    const x1 = fromNode.x + fromNode.width;
    const y1 = fromNode.y + fromNode.height / 2;
    const x2 = toNode.x;
    const y2 = toNode.y + toNode.height / 2;
    const dx = x2 - x1;
    const cx = dx > 0
      ? Math.max(60, dx * 0.45)
      : Math.max(120, Math.abs(dx) * 0.6);
    const d  = `M ${x1} ${y1} C ${x1 + cx} ${y1} ${x2 - cx} ${y2} ${x2} ${y2}`;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return { d, mx, my };
  }

  // ホバー中エッジ情報
  const hoveredEdge = hoveredEdgeId ? edges.find(e => e.id === hoveredEdgeId) ?? null : null;
  const hasEnding = phases.some(p => p.phase_type === "ending");
  const hasStart  = phases.some(p => p.phase_type === "start");

  const selectedPhase = selectedPhaseId ? phases.find(p => p.id === selectedPhaseId) ?? null : null;

  // パスの遷移IDセット（trans-${id} 形式 → id 部分で比較）
  const pathTransEdgeIds = useMemo(() => {
    if (!ancestorPath) return new Set<string>();
    const set = new Set<string>();
    for (const tid of ancestorPath.pathTransitionIds) {
      set.add(`trans-${tid}`);
    }
    return set;
  }, [ancestorPath]);

  const pathPhaseNodeIds = useMemo(() => {
    if (!ancestorPath) return new Set<string>();
    const set = new Set<string>();
    for (const pid of ancestorPath.pathPhaseIds) {
      set.add(`phase-${pid}`);
    }
    return set;
  }, [ancestorPath]);

  // エッジを通常と強調表示に分離
  const normalEdges = edges.filter(e => !pathTransEdgeIds.has(e.id));
  const pathEdges   = edges.filter(e => pathTransEdgeIds.has(e.id));

  return (
    <div>
      {/* ウォーニングバナー */}
      {hasEnding && !hasEndingReachable && phases.length > 0 && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 8, padding: "8px 14px", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 12, color: "#92400e",
        }}>
          ⚠️ スタートからエンディングへ到達できる経路がありません。遷移を設定してください。
        </div>
      )}

      {/* メインレイアウト */}
      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
        {/* キャンバス */}
        <div
          ref={containerRef}
          style={{
            flex:         1,
            position:     "relative",
            minWidth:     0,
            height:       680,
            overflow:     "hidden",
            background:   "#f1f5f9",
            border:       "1px solid #e2e8f0",
            borderRadius: selectedPhase ? "14px 0 0 14px" : 14,
            cursor:       isPanning ? "grabbing" : isDragging ? "grabbing" : connectDrag ? "crosshair" : "grab",
            userSelect:   "none",
            touchAction:  "none",
          }}
          onMouseDown={handleBgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleBgMouseUp}
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

          {/* SVG エッジレイヤー（視覚） */}
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
              <marker id="ng-arr-amber" markerWidth={10} markerHeight={8} refX={9} refY={4} orient="auto">
                <path d="M0 0 L10 4 L0 8 Z" fill="#f59e0b" fillOpacity={0.85} />
              </marker>
              <marker id="ng-arr-blue" markerWidth={10} markerHeight={8} refX={9} refY={4} orient="auto">
                <path d="M0 0 L10 4 L0 8 Z" fill="#2563eb" fillOpacity={1} />
              </marker>
            </defs>

            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* 通常エッジ */}
              {normalEdges.map(edge => {
                const from = nodeMap[edge.fromId];
                const to   = nodeMap[edge.toId];
                if (!from || !to) return null;

                const { d, mx, my } = edgePath(from, to);
                const isTrans   = edge.kind === "phase-transition";
                const isMsg     = edge.kind === "qr-message";
                const isLoop    = edge.transitionId ? loopTransitionIds.has(edge.transitionId) : false;

                let strokeColor = isTrans
                  ? (isLoop ? "#f59e0b" : "#94a3b8")
                  : isMsg ? "#c2410c" : "#7c3aed";
                const markerId = isTrans
                  ? (isLoop ? "ng-arr-amber" : "ng-arr-gray")
                  : isMsg ? "ng-arr-orange" : "ng-arr-purple";

                let strokeWidth    = 1.8;
                let strokeDasharray: string | undefined = undefined;
                let strokeOpacity  = 0.8;

                if (isTrans) {
                  if (edge.isDefault) {
                    strokeWidth   = 2.5;
                    strokeOpacity = 0.75;
                  } else {
                    strokeWidth     = 1.5;
                    strokeDasharray = "5 3";
                    strokeOpacity   = 0.6;
                  }
                  if (isLoop) strokeColor = "#f59e0b";
                }

                const badge = getEdgeBadge(edge);
                const labelW = Math.min(120, Math.max(40, badge.text.length * 7 + 16));

                return (
                  <g key={edge.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDasharray}
                      strokeOpacity={strokeOpacity}
                      markerEnd={`url(#${markerId})`}
                    />
                    <rect
                      x={mx - labelW / 2}
                      y={my - 10}
                      width={labelW}
                      height={20}
                      rx={5}
                      fill="white"
                      stroke={badge.borderColor}
                      strokeWidth={1}
                      fillOpacity={0.95}
                    />
                    <text
                      x={mx}
                      y={my + 5}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill={badge.color}
                    >
                      {badge.text}
                    </text>
                  </g>
                );
              })}

              {/* パスハイライトエッジ（青、前面） */}
              {pathEdges.map(edge => {
                const from = nodeMap[edge.fromId];
                const to   = nodeMap[edge.toId];
                if (!from || !to) return null;
                const { d, mx, my } = edgePath(from, to);
                const badge = getEdgeBadge(edge);
                const labelW = Math.min(120, Math.max(40, badge.text.length * 7 + 16));
                return (
                  <g key={`path-${edge.id}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth={3}
                      strokeOpacity={1}
                      markerEnd="url(#ng-arr-blue)"
                    />
                    <rect
                      x={mx - labelW / 2}
                      y={my - 10}
                      width={labelW}
                      height={20}
                      rx={5}
                      fill="#eff6ff"
                      stroke="#93c5fd"
                      strokeWidth={1}
                      fillOpacity={0.97}
                    />
                    <text
                      x={mx}
                      y={my + 5}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill="#1d4ed8"
                    >
                      {badge.text}
                    </text>
                  </g>
                );
              })}

              {/* 接続ドラッグのラバーバンド */}
              {connectDrag && (() => {
                const fromNode = initialNodes.find(n => n.phaseId === connectDrag.fromPhaseId);
                if (!fromNode) return null;
                const fPos = getPos(fromNode.id);
                const x1 = fPos.x + fromNode.width;
                const y1 = fPos.y + fromNode.height / 2;
                // curX/curY はスクリーン座標（canvas内相対）
                const cx2 = (connectDrag.curX - pan.x) / zoom;
                const cy2 = (connectDrag.curY - pan.y) / zoom;
                const color = connectDrag.targetPhaseId ? "#16a34a" : "#94a3b8";
                return (
                  <line
                    x1={x1} y1={y1}
                    x2={cx2} y2={cy2}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    strokeOpacity={0.8}
                  />
                );
              })()}
            </g>
          </svg>

          {/* SVG ホバーヒットボックス（透明、pointerEvents: all） */}
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
            aria-hidden
            onMouseMove={e => {
              setTooltipPos({ x: e.clientX, y: e.clientY });
            }}
          >
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`} style={{ pointerEvents: "all" }}>
              {edges.map(edge => {
                const from = nodeMap[edge.fromId];
                const to   = nodeMap[edge.toId];
                if (!from || !to) return null;
                const { d } = edgePath(from, to);
                const isSelectedEdge = edge.transitionId === selectedTransitionId;
                return (
                  <path
                    key={`hit-${edge.id}`}
                    d={d}
                    fill="none"
                    stroke={isSelectedEdge ? "#2563eb" : "transparent"}
                    strokeWidth={isSelectedEdge ? 4 : 16}
                    strokeOpacity={isSelectedEdge ? 0.4 : 1}
                    style={{ pointerEvents: "stroke", cursor: edge.kind === "phase-transition" ? "pointer" : "default" }}
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                    onMouseDown={e => { if (edge.kind === "phase-transition") e.stopPropagation(); }}
                    onClick={e => {
                      if (edge.kind !== "phase-transition" || !edge.transitionId) return;
                      e.stopPropagation();
                      const t = transitions.find(tr => tr.id === edge.transitionId);
                      if (t) {
                        setSelectedTransitionId(edge.transitionId);
                        setSelectedPhaseId(t.from_phase_id);
                        setPrefillTargetPhaseId(null);
                        setBgClickPos(null);
                      }
                    }}
                  />
                );
              })}
            </g>
          </svg>

          {/* HTMLノードレイヤー */}
          {initialNodes.map(initNode => {
            const node      = nodeMap[initNode.id];
            const isDrag    = nodeStart?.nodeId === node.id;
            const isHovered = hoveredNodeId === node.id && !nodeStart;
            const isPhase   = node.type === "phase";
            const phaseId   = node.phaseId;
            const isSelected = phaseId ? selectedPhaseId === phaseId : false;
            const isReachable = phaseId ? reachablePhaseIds.has(phaseId) : true;
            const isInPath    = pathPhaseNodeIds.has(node.id);
            const isUnreachable = isPhase && phaseId && !isReachable && node.phaseType !== "start";

            const screenL = pan.x + node.x * zoom;
            const screenT = pan.y + node.y * zoom;
            const screenW = node.width  * zoom;
            const screenH = node.height * zoom;

            // ノード枠線スタイル（selected / unreachable）
            let nodeOutline: string | undefined;
            let nodeBorderColor: string | undefined;
            let nodeBoxShadow: string | undefined;
            if (isSelected) {
              nodeOutline   = "3px solid #2563eb";
              nodeBoxShadow = "0 0 0 3px rgba(37,99,235,0.2)";
            } else if (isUnreachable) {
              nodeBorderColor = "#f59e0b";
            }

            return (
              <div
                key={node.id}
                style={{
                  position: "absolute",
                  left:     screenL,
                  top:      screenT,
                  width:    screenW,
                  height:   screenH,
                  zIndex:   isDrag ? 20 : isHovered ? 10 : isPhase ? 5 : 3,
                  cursor:   isDrag ? "grabbing" : "grab",
                }}
                onMouseDown={e => handleNodeMouseDown(e, node.id)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  if (!draggedRef.current && isPhase && phaseId) {
                    setSelectedPhaseId(prev => prev === phaseId ? null : phaseId);
                    setPrefillTargetPhaseId(null);
                    setBgClickPos(null);
                  }
                }}
              >
                <div style={{
                  width:           node.width,
                  height:          node.height,
                  transform:       `scale(${zoom})`,
                  transformOrigin: "top left",
                  boxSizing:       "border-box",
                  outline:         nodeOutline,
                  boxShadow:       nodeBoxShadow,
                  borderRadius:    isPhase ? 10 : 8,
                }}>
                  <Link
                    href={node.href}
                    style={{ textDecoration: "none", display: "block", height: "100%" }}
                    onClick={e => { if (draggedRef.current) e.preventDefault(); }}
                  >
                    {node.type === "phase" ? (
                      <PhaseNodeCard
                        node={node}
                        isDragging={isDrag}
                        borderOverride={isUnreachable ? "2.5px solid #f59e0b" : undefined}
                        inPath={isInPath}
                      />
                    ) : (
                      <MessageNodeCard node={node} isDragging={isDrag} />
                    )}
                  </Link>
                </div>

                {/* hover 時の編集バッジ */}
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
                    onMouseDown={e => e.stopPropagation()}
                  >
                    ✏ 編集
                  </a>
                )}

                {/* 接続ハンドル（⊕）— フェーズノードのみ、canEdit 時 */}
                {canEdit && isPhase && phaseId && isHovered && (
                  <div
                    style={{
                      position:    "absolute",
                      right:       -12,
                      top:         "50%",
                      transform:   "translateY(-50%)",
                      width:       22,
                      height:      22,
                      background:  "#2563eb",
                      color:       "white",
                      borderRadius: "50%",
                      display:     "flex",
                      alignItems:  "center",
                      justifyContent: "center",
                      fontSize:    14,
                      cursor:      "crosshair",
                      zIndex:      30,
                      boxShadow:   "0 2px 6px rgba(37,99,235,0.35)",
                    }}
                    title="ドラッグして接続"
                    onMouseDown={e => {
                      e.stopPropagation();
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const fPos = getPos(node.id);
                      setConnectDrag({
                        fromPhaseId: phaseId,
                        startX: fPos.x + node.width,
                        startY: fPos.y + node.height / 2,
                        curX: e.clientX - rect.left,
                        curY: e.clientY - rect.top,
                        targetPhaseId: null,
                      });
                    }}
                  >
                    ⊕
                  </div>
                )}

                {/* 到達不能ノードのツールチップ */}
                {isUnreachable && isHovered && (
                  <div style={{
                    position:    "absolute",
                    bottom:      "100%",
                    left:        "50%",
                    transform:   "translateX(-50%)",
                    marginBottom: 6,
                    background:  "#1f2937",
                    color:       "white",
                    fontSize:    11,
                    padding:     "4px 10px",
                    borderRadius: 6,
                    whiteSpace:  "nowrap",
                    zIndex:      40,
                    pointerEvents: "none",
                    boxShadow:   "0 2px 8px rgba(0,0,0,0.2)",
                  }}>
                    ⚠ このフェーズはスタートから到達できません
                  </div>
                )}
              </div>
            );
          })}

          {/* エッジホバートゥールチップ */}
          {hoveredEdge && (() => {
            const toNode = initialNodes.find(n => n.id === hoveredEdge.toId);
            const toLabel = toNode?.label ?? hoveredEdge.toId;
            const rect = containerRef.current?.getBoundingClientRect();
            const sx = rect ? tooltipPos.x - rect.left : tooltipPos.x;
            const sy = rect ? tooltipPos.y - rect.top  : tooltipPos.y;
            return (
              <div style={{
                position:    "absolute",
                left:        sx + 14,
                top:         sy - 10,
                background:  "#1f2937",
                color:       "white",
                fontSize:    11,
                padding:     "6px 10px",
                borderRadius: 8,
                pointerEvents: "none",
                zIndex:      50,
                maxWidth:    220,
                boxShadow:   "0 2px 10px rgba(0,0,0,0.25)",
                lineHeight:  1.6,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{hoveredEdge.label}</div>
                {hoveredEdge.condition && (
                  <div style={{ color: "#93c5fd" }}>🔑 {hoveredEdge.condition}</div>
                )}
                {hoveredEdge.flagCondition && (
                  <div style={{ color: "#c4b5fd" }}>⚑ {hoveredEdge.flagCondition}</div>
                )}
                <div style={{ color: "#9ca3af", marginTop: 2 }}>→ {toLabel}</div>
              </div>
            );
          })()}

          {/* バックグラウンドクリック：フェーズ追加フォーム */}
          {bgClickPos && canEdit && (() => {
            const sl = pan.x + bgClickPos.x * zoom;
            const st = pan.y + bgClickPos.y * zoom;
            return (
              <div
                style={{
                  position:    "absolute",
                  left:        Math.min(sl, (containerRef.current?.clientWidth ?? 800) - 240),
                  top:         Math.min(st, (containerRef.current?.clientHeight ?? 680) - 180),
                  background:  "white",
                  border:      "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding:     "12px 14px",
                  zIndex:      60,
                  width:       220,
                  boxShadow:   "0 4px 16px rgba(0,0,0,0.12)",
                  display:     "flex",
                  flexDirection: "column",
                  gap:         8,
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>＋ フェーズを追加</div>
                <input
                  autoFocus
                  value={bgFormName}
                  onChange={e => setBgFormName(e.target.value)}
                  placeholder="フェーズ名"
                  style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
                  onKeyDown={e => { if (e.key === "Enter") handleCreatePhase(); if (e.key === "Escape") setBgClickPos(null); }}
                />
                <select
                  value={bgFormType}
                  onChange={e => setBgFormType(e.target.value as PhaseType)}
                  style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 6px" }}
                >
                  {!hasStart && <option value="start">開始</option>}
                  <option value="normal">通常</option>
                  <option value="ending">エンディング</option>
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleCreatePhase}
                    disabled={bgFormSaving || !bgFormName.trim()}
                    style={{
                      fontSize: 11, padding: "5px 12px",
                      background: "#2563eb", color: "white",
                      border: "none", borderRadius: 4, cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {bgFormSaving ? "作成中…" : "作成"}
                  </button>
                  <button
                    onClick={() => setBgClickPos(null)}
                    style={{
                      fontSize: 11, padding: "5px 10px",
                      background: "#f3f4f6", color: "#374151",
                      border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
                    }}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            );
          })()}

          {/* コントロール */}
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
            <LegendRow color="#94a3b8" dash         label="遷移設定（デフォルト）" />
            <LegendRow color="#94a3b8" dash         label="遷移設定（条件付き）" dashed />
            <LegendRow color="#f59e0b" dash         label="ループ遷移" />
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

        {/* 右パネル */}
        {selectedPhase && (
          <div style={{
            width:      300,
            flexShrink: 0,
            overflowY:  "auto",
            background: "#fff",
            borderRadius: "0 14px 14px 0",
            border:     "1px solid #e2e8f0",
            borderLeft: "none",
          }}>
            <RightPanel
              phase={selectedPhase}
              transitions={transitions}
              phases={phases}
              oaId={oaId}
              workId={workId}
              canEdit={canEdit}
              onClose={() => { setSelectedPhaseId(null); setPrefillTargetPhaseId(null); setSelectedTransitionId(null); }}
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

// ── フェーズノードカード ──────────────────────────
function PhaseNodeCard({
  node,
  isDragging,
  borderOverride,
  inPath,
}: {
  node: LayoutNode;
  isDragging: boolean;
  borderOverride?: string;
  inPath?: boolean;
}) {
  const meta = node.phaseType ? (PHASE_META[node.phaseType] ?? PHASE_META.normal) : PHASE_META.normal;
  return (
    <div style={{
      width:        "100%",
      height:       "100%",
      background:   node.bg,
      border:       borderOverride ?? `2px solid ${node.border}`,
      borderLeft:   `5px solid ${node.color}`,
      borderRadius: 10,
      padding:      "9px 12px",
      boxSizing:    "border-box",
      display:      "flex",
      flexDirection: "column",
      justifyContent: "center",
      boxShadow:    isDragging
        ? "0 10px 32px rgba(0,0,0,0.16)"
        : inPath
        ? "0 0 0 2px #93c5fd, 0 2px 10px rgba(0,0,0,0.08)"
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
      width:        "100%",
      height:       "100%",
      background:   "#fff",
      border:       `1.5px solid ${node.border}`,
      borderLeft:   `3.5px solid ${node.color}`,
      borderRadius: 8,
      padding:      "6px 10px",
      boxSizing:    "border-box",
      display:      "flex",
      flexDirection: "column",
      justifyContent: "center",
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
function LegendRow({
  color,
  dash,
  label,
  dashed,
}: {
  color: string;
  dash: boolean;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <svg width={24} height={10} style={{ flexShrink: 0 }}>
        <line
          x1={0} y1={5} x2={24} y2={5}
          stroke={color} strokeWidth={2}
          strokeDasharray={dash || dashed ? "4 2" : undefined}
          strokeOpacity={dash || dashed ? 0.6 : 0.9}
        />
        <polygon points="20,2 24,5 20,8" fill={color} fillOpacity={dash || dashed ? 0.6 : 0.9} />
      </svg>
      <span style={{ fontSize: 10, color: "#6b7280" }}>{label}</span>
    </div>
  );
}
