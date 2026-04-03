"use client";

// src/app/oas/[id]/works/[workId]/scenario/page.tsx
// シナリオフロー — フェーズカード＋ツリー分岐表示
// フェーズ追加・D&D並び替え・インライン軽編集を統合

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { workApi, phaseApi, transitionApi, messageApi, getDevToken } from "@/lib/api-client";
import type { QuickReplyItem, Message, UpdatePhaseBody } from "@/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { HelpAccordion } from "@/components/HelpAccordion";
import { useToast } from "@/components/Toast";
import type { PhaseWithCounts, TransitionWithPhases, PhaseType } from "@/types";
import { NodeGraph } from "./_node-graph";

// ── フェーズ種別メタ ──────────────────────────────
const PHASE_TYPE_META: Record<PhaseType, { label: string; color: string; bg: string; border: string }> = {
  start:  { label: "開始",         color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  normal: { label: "通常",         color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  ending: { label: "エンディング", color: "#9333ea", bg: "#faf5ff", border: "#e9d5ff" },
};

const PHASE_TYPE_OPTIONS: { value: PhaseType; label: string; dot: string }[] = [
  { value: "start",   label: "開始",         dot: "#22c55e" },
  { value: "normal",  label: "通常",         dot: "#3b82f6" },
  { value: "ending",  label: "エンディング", dot: "#a855f7" },
];

// ── メッセージ種別メタ ────────────────────────────
const MSG_KIND_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  start:    { label: "開始",   color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  normal:   { label: "通常",   color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  response: { label: "応答",   color: "#7c3aed", bg: "#f5f3ff", border: "#e9d5ff" },
  hint:     { label: "ヒント", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  puzzle:   { label: "謎",     color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
};

// ── 分岐の意味から色を推定 ────────────────────────
function branchColor(label: string): { color: string; bg: string; border: string } {
  const l = label.toLowerCase();
  if (l.includes("不正解") || l.includes("wrong") || l.includes("incorrect") || l.includes("✗") || l.includes("×")) {
    return { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" };
  }
  if (l.includes("正解") || l.includes("correct") || l.includes("✓") || l.includes("○") || l.includes("ok")) {
    return { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" };
  }
  return { color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" };
}

// ── フォーム型 ────────────────────────────────────
interface PhaseForm {
  phase_type:  PhaseType;
  name:        string;
  description: string;
  is_active:   boolean;
}
const EMPTY_PHASE_FORM: PhaseForm = { phase_type: "normal", name: "", description: "", is_active: true };

// ── メインページ ──────────────────────────────────
export default function ScenarioPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]     = useState("");
  const [phases, setPhases]           = useState<PhaseWithCounts[]>([]);
  const [transitions, setTransitions] = useState<TransitionWithPhases[]>([]);
  const [msgQrData, setMsgQrData]     = useState<Record<string, MsgQrEntry[]>>({});
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [loading, setLoading]         = useState(true);

  // ビュー切り替え
  const [activeView, setActiveView] = useState<"card" | "node">("card");

  // フェーズ追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm]         = useState<PhaseForm>(EMPTY_PHASE_FORM);
  const [addErrors, setAddErrors]     = useState<Record<string, string>>({});
  const [addingPhase, setAddingPhase] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const token = getDevToken();
      const [work, phaseList, transitionList, allMsgs] = await Promise.all([
        workApi.get(token, workId),
        phaseApi.list(token, workId),
        transitionApi.listByWork(token, workId),
        messageApi.list(token, workId),
      ]);
      setWorkTitle(work.title);
      setPhases(phaseList.sort((a, b) => a.sort_order - b.sort_order));
      setAllMessages(allMsgs);
      const sortedTransitions = transitionList.sort((a, b) => a.sort_order - b.sort_order);
      setTransitions(sortedTransitions);

      const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
      const msgPreviewMap: Record<string, string> = {};
      for (const msg of allMsgs) {
        msgPreviewMap[msg.id] = msg.body
          ? msg.body.slice(0, 36) + (msg.body.length > 36 ? "…" : "")
          : `[${msg.kind}]`;
      }

      const transLabelMap: Record<string, Record<string, string>> = {};
      for (const t of sortedTransitions) {
        if (!transLabelMap[t.from_phase_id]) transLabelMap[t.from_phase_id] = {};
        transLabelMap[t.from_phase_id][norm(t.label)] = t.to_phase_id;
      }

      const data: Record<string, MsgQrEntry[]> = {};
      const sortedMsgs = [...allMsgs].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      for (const msg of sortedMsgs) {
        if (!msg.phase_id || !msg.quick_replies || msg.quick_replies.length === 0) continue;
        const qrItems = msg.quick_replies as QuickReplyItem[];
        const branches: QrBranch[] = [];
        for (const item of qrItems) {
          if (item.enabled === false) continue;
          const label = item.label;
          if (item.target_phase_id) {
            branches.push({ kind: "phase", label, phaseId: item.target_phase_id });
          } else if (item.target_type === "message" && item.target_message_id) {
            branches.push({ kind: "message", label, msgId: item.target_message_id,
              preview: msgPreviewMap[item.target_message_id] ?? `(ID: ${item.target_message_id.slice(0, 8)}…)` });
          } else if (item.action === "hint") {
            branches.push({ kind: "hint", label });
          } else if (item.action === "url" && item.value) {
            branches.push({ kind: "url", label, url: item.value });
          } else {
            const textVal = item.value?.trim() || label;
            const matchedPhaseId = transLabelMap[msg.phase_id]?.[norm(textVal)];
            if (matchedPhaseId) {
              branches.push({ kind: "phase", label, phaseId: matchedPhaseId });
            } else {
              branches.push({ kind: "text", label, value: textVal });
            }
          }
        }
        if (branches.length === 0) continue;
        if (!data[msg.phase_id]) data[msg.phase_id] = [];
        data[msg.phase_id].push({ msgId: msg.id, preview: msgPreviewMap[msg.id], branches });
      }
      setMsgQrData(data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── フェーズ追加 ──────────────────────────────────
  const hasStartPhase = phases.some((p) => p.phase_type === "start");

  async function handleAddPhase(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!addForm.name.trim()) errs.name = "フェーズ名を入力してください";
    if (Object.keys(errs).length) { setAddErrors(errs); return; }
    setAddingPhase(true);
    try {
      const token = getDevToken();
      const maxOrder = phases.length > 0 ? Math.max(...phases.map((p) => p.sort_order)) : 0;
      await phaseApi.create(token, {
        work_id:     workId,
        phase_type:  addForm.phase_type,
        name:        addForm.name.trim(),
        description: addForm.description.trim() || undefined,
        sort_order:  maxOrder + 10,
        is_active:   addForm.is_active,
      });
      showToast(`「${addForm.name.trim()}」を追加しました`, "success");
      setAddForm(EMPTY_PHASE_FORM);
      setShowAddForm(false);
      setAddErrors({});
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "追加に失敗しました";
      showToast(msg, "error");
      if (msg.includes("開始フェーズ")) setAddErrors({ phase_type: msg });
    } finally {
      setAddingPhase(false);
    }
  }

  // ── D&D 並び替え保存 ──────────────────────────────
  async function handleReorder(reordered: PhaseWithCounts[]) {
    setPhases(reordered);
    const token = getDevToken();
    try {
      await Promise.all(
        reordered.map((phase, idx) =>
          phaseApi.update(token, phase.id, { sort_order: idx * 10 })
        )
      );
    } catch {
      showToast("並び替えの保存に失敗しました。再読み込みします。", "error");
      await loadAll();
    }
  }

  // ── フェーズ更新（インライン） ────────────────────
  async function handleUpdatePhase(phaseId: string, updates: UpdatePhaseBody): Promise<void> {
    setPhases(prev => prev.map(p => p.id === phaseId ? { ...p, ...updates } : p));
    try {
      const updated = await phaseApi.update(getDevToken(), phaseId, updates);
      setPhases(prev => prev.map(p => p.id === phaseId ? { ...p, ...updated } : p));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新に失敗しました", "error");
      await loadAll();
      throw err;
    }
  }

  // ── フェーズ複製 ─────────────────────────────────
  async function handleDuplicatePhase(phaseId: string): Promise<void> {
    const phase = phases.find(p => p.id === phaseId);
    if (!phase) return;
    const maxOrder = phases.length > 0 ? Math.max(...phases.map(p => p.sort_order)) : 0;
    try {
      await phaseApi.create(getDevToken(), {
        work_id:    workId,
        phase_type: phase.phase_type === "start" ? "normal" : phase.phase_type,
        name:       `${phase.name}（コピー）`,
        sort_order: maxOrder + 10,
        is_active:  phase.is_active,
      });
      showToast(`「${phase.name}」を複製しました`, "success");
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "複製に失敗しました", "error");
      throw err;
    }
  }

  // ── フェーズ削除 ─────────────────────────────────
  async function handleDeletePhase(phaseId: string): Promise<void> {
    const phase = phases.find(p => p.id === phaseId);
    setPhases(prev => prev.filter(p => p.id !== phaseId));
    try {
      await phaseApi.delete(getDevToken(), phaseId);
      showToast(`「${phase?.name ?? "フェーズ"}」を削除しました`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
      await loadAll();
      throw err;
    }
  }

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "シナリオフロー" },
          ]} />
          <h2>シナリオフロー</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            フェーズの追加・並び替え・軽編集と分岐構造を1画面で管理できます。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              setAddForm(EMPTY_PHASE_FORM);
              setAddErrors({});
              setShowAddForm((v) => !v);
            }}
          >
            ＋ フェーズを追加
          </button>
          <Link href={`/oas/${oaId}/works/${workId}/phases`} className="btn btn-ghost">
            🗂 フェーズを管理
          </Link>
        </div>
      </div>

      {/* ── フェーズ追加フォーム（インライン） ── */}
      {showAddForm && (
        <div className="card" style={{
          marginBottom: 16,
          border: "2px solid #2563eb",
          borderRadius: 12,
          maxWidth: 640,
        }}>
          <p style={{ fontWeight: 700, marginBottom: 14, color: "#2563eb", fontSize: 13 }}>
            ＋ 新しいフェーズを追加
          </p>
          <form onSubmit={handleAddPhase}>
            <div className="form-group">
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>
                フェーズ種別 <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PHASE_TYPE_OPTIONS.map(({ value, label, dot }) => {
                  const meta     = PHASE_TYPE_META[value];
                  const disabled = value === "start" && hasStartPhase;
                  const checked  = addForm.phase_type === value;
                  return (
                    <label key={value} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 20, cursor: disabled ? "not-allowed" : "pointer",
                      border: checked ? `2px solid ${meta.color}` : "1.5px solid #e5e7eb",
                      background: checked ? meta.bg : "#fff",
                      opacity: disabled ? 0.4 : 1, transition: "all 0.12s",
                      fontSize: 13, fontWeight: checked ? 700 : 400,
                      color: checked ? meta.color : "#374151",
                      userSelect: "none",
                    }}>
                      <input
                        type="radio" name="add-phase-type" value={value}
                        checked={checked} disabled={disabled}
                        onChange={() => !disabled && setAddForm({ ...addForm, phase_type: value })}
                        style={{ display: "none" }}
                      />
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                      {label}
                      {disabled && <span style={{ fontSize: 10, color: "#9ca3af" }}>（既存）</span>}
                    </label>
                  );
                })}
              </div>
              {addErrors.phase_type && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>{addErrors.phase_type}</p>}
            </div>

            <div className="form-group">
              <label htmlFor="add-phase-name" style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
                フェーズ名 <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="add-phase-name"
                type="text"
                className="form-input"
                value={addForm.name}
                onChange={(e) => { setAddForm({ ...addForm, name: e.target.value }); setAddErrors({}); }}
                placeholder="例: 序章 / 謎解きパート / 真相エンド"
                maxLength={100}
                autoFocus
              />
              {addErrors.name && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>{addErrors.name}</p>}
            </div>

            <div className="form-group">
              <label htmlFor="add-phase-desc" style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
                説明 <span style={{ fontWeight: 400, color: "#9ca3af" }}>（任意）</span>
              </label>
              <textarea
                id="add-phase-desc"
                className="form-input"
                value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                placeholder="このフェーズで起こることを簡単に記述"
                maxLength={500}
                rows={2}
                style={{ resize: "vertical", minHeight: 54 }}
              />
            </div>

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={addForm.is_active}
                  onChange={(e) => setAddForm({ ...addForm, is_active: e.target.checked })}
                />
                有効にする
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setShowAddForm(false); setAddErrors({}); }}
                disabled={addingPhase}
              >
                キャンセル
              </button>
              <button type="submit" className="btn btn-primary" disabled={addingPhase}>
                {addingPhase && <span className="spinner" />}
                {addingPhase ? "追加中..." : "フェーズを追加"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── ビュー切り替えタブ ── */}
      <div style={{
        display: "inline-flex", gap: 0,
        border: "1px solid #e5e7eb", borderRadius: 8,
        overflow: "hidden", marginBottom: 16,
      }}>
        {(["card", "node"] as const).map((v, i) => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            style={{
              padding: "6px 20px", fontSize: 13,
              fontWeight: activeView === v ? 700 : 400,
              background: activeView === v ? "#2563eb" : "#fff",
              color:      activeView === v ? "#fff" : "#6b7280",
              border: "none",
              borderRight: i === 0 ? "1px solid #e5e7eb" : "none",
              cursor: "pointer", transition: "background 0.15s, color 0.15s",
            }}
          >
            {v === "card" ? "📋 カードビュー" : "🗺 ノードビュー"}
          </button>
        ))}
      </div>

      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "フェーズ名・種別の編集、有効/無効の切り替え、複製・削除がカード上で直接できます",
          "フェーズカードはクリックして展開するとメッセージ一覧と分岐が確認できます",
          "詳細な設定はカード内「詳細を開く」または「フェーズを管理」から行ってください",
        ]},
        { icon: "↕", title: "フェーズの並び替え", points: [
          "フェーズカード左端の ⠿ ハンドルをドラッグして並び順を変更できます",
          "並び替え結果は自動で保存されます",
        ]},
        { icon: "🗺", title: "フローの読み方", points: [
          "「開始」フェーズから始まり「エンディング」フェーズで終わります",
          "矢印は遷移条件（正解・不正解など）を表します",
          "遷移のないフェーズには必ず接続してください",
        ]},
      ]} />

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card" style={{ padding: 20 }}>
              <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: 300, height: 13 }} />
            </div>
          ))}
        </div>
      ) : phases.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: "40px 16px" }}>
            <div className="empty-state-icon">🗺️</div>
            <p className="empty-state-title">フェーズがまだありません</p>
            <p className="empty-state-desc">
              「フェーズを追加」からシナリオの構成要素を作成しましょう。
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => {
                setAddForm(EMPTY_PHASE_FORM);
                setAddErrors({});
                setShowAddForm(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              ＋ 最初のフェーズを追加
            </button>
          </div>
        </div>
      ) : activeView === "node" ? (
        <NodeGraph
          phases={phases}
          transitions={transitions}
          allMessages={allMessages}
          oaId={oaId}
          workId={workId}
        />
      ) : (
        <FlowTree
          phases={phases}
          transitions={transitions}
          msgQrData={msgQrData}
          allMessages={allMessages}
          oaId={oaId}
          workId={workId}
          onReorder={handleReorder}
          onUpdate={handleUpdatePhase}
          onDuplicate={handleDuplicatePhase}
          onDelete={handleDeletePhase}
        />
      )}
    </>
  );
}

// ── QR 分岐データ型 ──────────────────────────────────
type QrBranch =
  | { kind: "phase";   label: string; phaseId: string }
  | { kind: "message"; label: string; msgId: string; preview: string }
  | { kind: "hint";    label: string }
  | { kind: "url";     label: string; url: string }
  | { kind: "text";    label: string; value: string };

interface MsgQrEntry {
  msgId:    string;
  preview:  string;
  branches: QrBranch[];
}

// ── FlowTree ──────────────────────────────────────
interface FlowTreeProps {
  phases:      PhaseWithCounts[];
  transitions: TransitionWithPhases[];
  msgQrData:   Record<string, MsgQrEntry[]>;
  allMessages: Message[];
  oaId:        string;
  workId:      string;
  onReorder:   (phases: PhaseWithCounts[]) => void;
  onUpdate:    (id: string, updates: UpdatePhaseBody) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onDelete:    (id: string) => Promise<void>;
}

function FlowTree({
  phases, transitions, msgQrData, allMessages,
  oaId, workId, onReorder, onUpdate, onDuplicate, onDelete,
}: FlowTreeProps) {
  const phaseMap = Object.fromEntries(phases.map((p) => [p.id, p]));
  const fromMap: Record<string, TransitionWithPhases[]> = {};
  for (const t of transitions) {
    if (!fromMap[t.from_phase_id]) fromMap[t.from_phase_id] = [];
    fromMap[t.from_phase_id].push(t);
  }
  const toMap: Record<string, TransitionWithPhases[]> = {};
  for (const t of transitions) {
    if (!toMap[t.to_phase_id]) toMap[t.to_phase_id] = [];
    toMap[t.to_phase_id].push(t);
  }

  const sorted = [...phases].sort((a, b) => a.sort_order - b.sort_order);

  // ── D&D 状態 ──
  const [dragOverIdx,   setDragOverIdx]  = useState<number | null>(null);
  const [dragAbove,     setDragAbove]    = useState(true);
  const dragSrcRef    = useRef<number | null>(null);
  const dragHandleRef = useRef<number | null>(null);

  // ── カード UI 状態 ──
  const [expandedIds,     setExpandedIds]     = useState<Record<string, boolean>>({});
  const [editingName,     setEditingName]     = useState<{ id: string; value: string } | null>(null);
  const [editingTypeId,   setEditingTypeId]   = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [savingIds,       setSavingIds]       = useState<Record<string, boolean>>({});
  const [duplicatingId,   setDuplicatingId]   = useState<string | null>(null);
  const [deletingId,      setDeletingId]      = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
    // 他のUI状態をリセット
    if (editingTypeId === id) setEditingTypeId(null);
  }

  // ── 名前インライン編集 ──
  async function handleNameSave(id: string) {
    if (!editingName || editingName.id !== id) return;
    const newName = editingName.value.trim();
    setEditingName(null);
    if (!newName) return;
    const current = phases.find(p => p.id === id);
    if (newName === current?.name) return;
    setSavingIds(prev => ({ ...prev, [id]: true }));
    try {
      await onUpdate(id, { name: newName });
    } catch { /* parent shows toast */ } finally {
      setSavingIds(prev => ({ ...prev, [id]: false }));
    }
  }

  // ── 種別変更 ──
  async function handleTypeChange(id: string, newType: PhaseType) {
    setEditingTypeId(null);
    const current = phases.find(p => p.id === id);
    if (newType === current?.phase_type) return;
    setSavingIds(prev => ({ ...prev, [id]: true }));
    try {
      await onUpdate(id, { phase_type: newType });
    } catch { /* parent shows toast */ } finally {
      setSavingIds(prev => ({ ...prev, [id]: false }));
    }
  }

  // ── 有効/無効トグル ──
  async function handleToggleActive(id: string, currentValue: boolean) {
    setSavingIds(prev => ({ ...prev, [id]: true }));
    try {
      await onUpdate(id, { is_active: !currentValue });
    } catch { /* parent shows toast */ } finally {
      setSavingIds(prev => ({ ...prev, [id]: false }));
    }
  }

  // ── 複製 ──
  async function handleDuplicate(id: string) {
    setDuplicatingId(id);
    try {
      await onDuplicate(id);
    } catch { /* parent shows toast */ } finally {
      setDuplicatingId(null);
    }
  }

  // ── 削除 ──
  async function handleDelete(id: string) {
    setDeleteConfirmId(null);
    setDeletingId(id);
    try {
      await onDelete(id);
    } catch { /* parent shows toast */ } finally {
      setDeletingId(null);
    }
  }

  // ── D&D ハンドラ ──
  function handleDragStart(e: React.DragEvent, index: number) {
    dragSrcRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    setDragOverIdx(index);
    setDragAbove(above);
  }
  function handleDragLeave() { setDragOverIdx(null); }
  function handleDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    const srcIdx = dragSrcRef.current;
    setDragOverIdx(null);
    dragSrcRef.current = null;
    if (srcIdx === null || srcIdx === dropIdx) return;
    const next = [...sorted];
    const [moved] = next.splice(srcIdx, 1);
    const insertAt = srcIdx < dropIdx
      ? (dragAbove ? dropIdx - 1 : dropIdx)
      : (dragAbove ? dropIdx    : dropIdx + 1);
    next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved);
    onReorder(next);
  }
  function handleDragEnd() {
    dragSrcRef.current    = null;
    dragHandleRef.current = null;
    setDragOverIdx(null);
  }

  // ── 整合性チェック ──
  const startCount    = phases.filter((p) => p.phase_type === "start").length;
  const deadEndPhases = phases.filter(
    (p) => p.phase_type !== "ending" && (fromMap[p.id] ?? []).length === 0
  );
  const orphanPhases  = phases.filter(
    (p) => p.phase_type !== "start" && (toMap[p.id] ?? []).length === 0
  );
  const hasWarnings = startCount === 0 || deadEndPhases.length > 0 || orphanPhases.length > 0;

  // ── スタイル定数 ──
  const iconBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: 6,
    border: "1px solid #e5e7eb", background: "#fff",
    cursor: "pointer", fontSize: 14, lineHeight: 1,
    color: "#6b7280", flexShrink: 0,
    transition: "background 0.12s, color 0.12s",
  };

  return (
    <div>
      {/* 整合性ウォーニング */}
      {hasWarnings && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10,
          padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#92400e",
        }}>
          <strong style={{ display: "block", marginBottom: 6 }}>⚠ シナリオの構成に注意が必要な箇所があります</strong>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            {startCount === 0 && (
              <li>開始フェーズがありません。Bot がどこからシナリオを始めるか不明です。</li>
            )}
            {deadEndPhases.map((p) => (
              <li key={p.id}>
                <span style={{ fontWeight: 600 }}>「{p.name}」</span>
                （{PHASE_TYPE_META[p.phase_type].label}）に遷移が設定されていません。
                <Link href={`/oas/${oaId}/works/${workId}/phases/${p.id}`}
                  style={{ color: "#b45309", textDecoration: "underline", marginLeft: 6 }}>
                  遷移を追加 →
                </Link>
              </li>
            ))}
            {orphanPhases.map((p) => (
              <li key={p.id}>
                <span style={{ fontWeight: 600 }}>「{p.name}」</span>
                （{PHASE_TYPE_META[p.phase_type].label}）へ向かう遷移がありません（孤立）。
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* フェーズカードリスト */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {sorted.map((phase, phaseIdx) => {
          const meta       = PHASE_TYPE_META[phase.phase_type];
          const outgoing   = fromMap[phase.id] ?? [];
          const isLast     = phaseIdx === sorted.length - 1;
          const hasNoOut   = phase.phase_type !== "ending" && outgoing.length === 0 && phases.length > 1;
          const isDragOver = dragOverIdx === phaseIdx;
          const isSrc      = dragSrcRef.current === phaseIdx;
          const isExpanded = !!expandedIds[phase.id];
          const isSaving   = !!savingIds[phase.id];
          const isDuplicating = duplicatingId === phase.id;
          const isDeleting    = deletingId    === phase.id;
          const isEditingName = editingName?.id === phase.id;
          const isEditingType = editingTypeId  === phase.id;
          const isConfirmDelete = deleteConfirmId === phase.id;

          // このフェーズのメッセージ（sort_order 順）
          const phaseMessages = allMessages
            .filter(m => m.phase_id === phase.id)
            .sort((a, b) => ((a as { sort_order?: number }).sort_order ?? 0) - ((b as { sort_order?: number }).sort_order ?? 0));

          return (
            <div key={phase.id}>
              {/* D&D ドロップインジケーター（上） */}
              {isDragOver && dragAbove && (
                <div style={{ height: 3, borderRadius: 2, background: "#2563eb", margin: "2px 0" }} />
              )}

              {/* ── フェーズカード ── */}
              <div
                draggable
                onDragStart={(e) => {
                  if (dragHandleRef.current !== phaseIdx) { e.preventDefault(); return; }
                  handleDragStart(e, phaseIdx);
                }}
                onDragOver={(e) => handleDragOver(e, phaseIdx)}
                onDragLeave={handleDragLeave}
                onDrop={(e)      => handleDrop(e, phaseIdx)}
                onDragEnd={handleDragEnd}
                style={{
                  background:   "#fff",
                  border:       isDragOver ? "1.5px dashed #2563eb" : "1px solid #e5e7eb",
                  borderLeft:   `4px solid ${isDragOver ? "#2563eb" : phase.is_active ? meta.color : "#d1d5db"}`,
                  borderRadius: 12,
                  boxShadow:    isSrc ? "0 4px 20px rgba(0,0,0,0.12)" : "0 2px 8px rgba(0,0,0,0.06)",
                  opacity:      isSrc || isDeleting ? 0.5 : 1,
                  overflow:     "hidden",
                  transition:   "box-shadow 0.15s, opacity 0.15s",
                }}
              >

                {/* ── ① カードヘッダー ── */}
                <div style={{ padding: "12px 12px 0 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34 }}>

                    {/* ドラッグハンドル */}
                    <span
                      onPointerDown={() => { dragHandleRef.current = phaseIdx; }}
                      onPointerUp={()   => { dragHandleRef.current = null; }}
                      style={{
                        color: "#c4c9d0", fontSize: 18, cursor: "grab",
                        userSelect: "none", lineHeight: 1, touchAction: "none",
                        flexShrink: 0, padding: "2px 4px", borderRadius: 4,
                      }}
                      title="ドラッグして並び替え"
                    >
                      ⠿
                    </span>

                    {/* 種別バッジ / 種別ピッカー */}
                    {isEditingType ? (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "#f9fafb", border: "1px solid #e5e7eb",
                        borderRadius: 8, padding: "3px 6px",
                      }}>
                        {PHASE_TYPE_OPTIONS.map(({ value, label }) => {
                          const m = PHASE_TYPE_META[value];
                          const isSelected = phase.phase_type === value;
                          return (
                            <button
                              key={value}
                              onClick={() => handleTypeChange(phase.id, value)}
                              style={{
                                fontSize: 11, fontWeight: isSelected ? 700 : 400,
                                color: m.color, background: isSelected ? m.bg : "transparent",
                                border: isSelected ? `1px solid ${m.border}` : "1px solid transparent",
                                padding: "2px 8px", borderRadius: 12, cursor: "pointer",
                                transition: "all 0.1s",
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => setEditingTypeId(null)}
                          style={{ ...iconBtn, width: 22, height: 22, fontSize: 12, border: "none", background: "transparent" }}
                          title="キャンセル"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingTypeId(phase.id)}
                        title="クリックで種別変更"
                        style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                          color: meta.color, background: meta.bg,
                          padding: "3px 10px", borderRadius: 20, flexShrink: 0,
                          border: `1px solid ${meta.border}`,
                          cursor: "pointer", transition: "opacity 0.1s",
                        }}
                      >
                        {meta.label}
                      </button>
                    )}

                    {/* フェーズ名（クリックで編集） */}
                    {isEditingName ? (
                      <input
                        autoFocus
                        value={editingName.value}
                        onChange={(e) => setEditingName({ id: phase.id, value: e.target.value })}
                        onBlur={() => handleNameSave(phase.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); handleNameSave(phase.id); }
                          if (e.key === "Escape") setEditingName(null);
                        }}
                        maxLength={100}
                        style={{
                          flex: 1, minWidth: 80,
                          fontSize: 15, fontWeight: 700, color: "#111827",
                          border: "1.5px solid #2563eb", borderRadius: 6,
                          padding: "2px 8px", outline: "none",
                          background: "#fff",
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => {
                          if (!isEditingType) setEditingName({ id: phase.id, value: phase.name });
                        }}
                        title="クリックして名前を編集"
                        style={{
                          flex: 1, fontWeight: 700, fontSize: 15, color: "#111827",
                          cursor: "text", lineHeight: 1.3, minWidth: 0,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {phase.name}
                        {hasNoOut && (
                          <span title="遷移が未設定" style={{ color: "#f59e0b", marginLeft: 6, fontSize: 11, fontWeight: 400 }}>
                            ⚠ 遷移なし
                          </span>
                        )}
                      </span>
                    )}

                    {/* セービングスピナー */}
                    {(isSaving || isDuplicating || isDeleting) && (
                      <span className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
                    )}

                    {/* アクションボタン群 / 削除確認 */}
                    {isConfirmDelete ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "#ef4444", whiteSpace: "nowrap" }}>削除しますか？</span>
                        <button
                          onClick={() => handleDelete(phase.id)}
                          style={{ ...iconBtn, background: "#ef4444", color: "#fff", border: "none", width: "auto", padding: "0 8px", fontSize: 11, fontWeight: 700 }}
                        >
                          削除
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          style={{ ...iconBtn, fontSize: 11, fontWeight: 600 }}
                        >
                          戻る
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {/* 複製 */}
                        <button
                          onClick={() => handleDuplicate(phase.id)}
                          disabled={isDuplicating || isSaving}
                          style={{ ...iconBtn }}
                          title="複製"
                        >
                          ⎘
                        </button>
                        {/* 削除 */}
                        <button
                          onClick={() => setDeleteConfirmId(phase.id)}
                          disabled={isDeleting || isSaving}
                          style={{ ...iconBtn }}
                          title="削除"
                        >
                          🗑
                        </button>
                        {/* 詳細 */}
                        <Link
                          href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
                          style={{ ...iconBtn, textDecoration: "none", fontSize: 13 }}
                          title="詳細を開く"
                        >
                          ↗
                        </Link>
                        {/* 展開/折りたたみ */}
                        <button
                          onClick={() => toggleExpand(phase.id)}
                          style={{ ...iconBtn, fontSize: 12, color: isExpanded ? "#2563eb" : "#9ca3af" }}
                          title={isExpanded ? "折りたたむ" : "展開する"}
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── ② メタ情報行（常に表示） ── */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  padding: "8px 12px 12px 38px",
                }}>
                  {/* 有効/無効トグル */}
                  <button
                    onClick={() => handleToggleActive(phase.id, phase.is_active)}
                    disabled={isSaving}
                    title={phase.is_active ? "有効（クリックで無効化）" : "無効（クリックで有効化）"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11, fontWeight: 600,
                      padding: "2px 9px", borderRadius: 20,
                      cursor: "pointer", transition: "all 0.15s",
                      border: phase.is_active ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
                      background: phase.is_active ? "#f0fdf4" : "#f9fafb",
                      color:      phase.is_active ? "#16a34a" : "#9ca3af",
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: phase.is_active ? "#22c55e" : "#d1d5db",
                      flexShrink: 0, transition: "background 0.15s",
                    }} />
                    {phase.is_active ? "有効" : "無効"}
                  </button>

                  {/* 開始トリガー（開始フェーズのみ） */}
                  {phase.phase_type === "start" && (
                    phase.start_trigger ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 11, fontWeight: 600, color: "#065f46",
                        background: "#d1fae5", border: "1px solid #6ee7b7",
                        borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap",
                      }}>
                        🔑 {phase.start_trigger}
                      </span>
                    ) : (
                      <Link
                        href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
                        style={{ textDecoration: "none" }}
                        title="開始トリガーを設定する"
                      >
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 11, color: "#9ca3af",
                          background: "#f3f4f6", border: "1px solid #e5e7eb",
                          borderRadius: 20, padding: "2px 9px", whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}>
                          🔑 トリガー未設定
                        </span>
                      </Link>
                    )
                  )}

                  {/* メッセージ数 */}
                  <Link
                    href={`/oas/${oaId}/works/${workId}/messages?phase_id=${phase.id}`}
                    style={{ textDecoration: "none" }}
                    title="このフェーズのメッセージ一覧"
                  >
                    <MetaChip icon="💬" value={phase._count.messages} label="メッセージ" linked />
                  </Link>

                  {/* 分岐数 */}
                  <MetaChip icon="⤵" value={outgoing.length} label="分岐" />

                  {/* エンディングバッジ */}
                  {phase.phase_type === "ending" && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: meta.color,
                      background: meta.bg, padding: "2px 8px", borderRadius: 6,
                      border: `1px solid ${meta.border}`,
                    }}>
                      🏁 シナリオ終端
                    </span>
                  )}
                </div>

                {/* ── ③ 展開コンテンツ ── */}
                {isExpanded && (
                  <>
                    {/* 説明 */}
                    {phase.description && (
                      <div style={{
                        borderTop: "1px solid #f3f4f6",
                        padding: "8px 16px 8px 48px",
                        background: "#fafafa",
                      }}>
                        <p style={{
                          fontSize: 12, color: "#6b7280",
                          margin: 0, lineHeight: 1.6,
                          whiteSpace: "pre-wrap", wordBreak: "break-all",
                        }}>
                          {phase.description}
                        </p>
                      </div>
                    )}

                    {/* メッセージ一覧 */}
                    <div style={{ borderTop: "1px solid #f3f4f6", background: "#f8fafc" }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: "#6b7280",
                        padding: "10px 16px 6px 48px", letterSpacing: 0.4,
                      }}>
                        📋 メッセージ一覧
                      </div>
                      {phaseMessages.length === 0 ? (
                        <p style={{ fontSize: 12, color: "#9ca3af", padding: "4px 16px 10px 48px", margin: 0 }}>
                          このフェーズにはまだメッセージがありません
                        </p>
                      ) : (
                        <div style={{ padding: "0 16px 10px 48px", display: "flex", flexDirection: "column", gap: 4 }}>
                          {phaseMessages.map((msg) => {
                            const km = MSG_KIND_META[msg.kind] ?? MSG_KIND_META.normal;
                            const preview = msg.body
                              ? msg.body.slice(0, 50) + (msg.body.length > 50 ? "…" : "")
                              : `[${msg.kind}]`;
                            return (
                              <Link
                                key={msg.id}
                                href={`/oas/${oaId}/works/${workId}/messages/${msg.id}`}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  textDecoration: "none", padding: "5px 8px",
                                  borderRadius: 6, background: "#fff",
                                  border: "1px solid #e5e7eb",
                                  transition: "background 0.1s",
                                }}
                              >
                                <span style={{
                                  fontSize: 10, fontWeight: 700,
                                  color: km.color, background: km.bg,
                                  border: `1px solid ${km.border}`,
                                  padding: "1px 6px", borderRadius: 8, flexShrink: 0,
                                }}>
                                  {km.label}
                                </span>
                                <span style={{ fontSize: 12, color: "#374151", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {preview}
                                </span>
                                <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>→</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* QR 分岐 */}
                    {(msgQrData[phase.id] ?? []).length > 0 && (
                      <div style={{
                        borderTop: "1px solid #f3f4f6",
                        background: "#f8fafc",
                        padding: "10px 20px 12px 48px",
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", marginBottom: 10, letterSpacing: 0.4 }}>
                          💬 クイックリプライ分岐
                        </div>
                        {(msgQrData[phase.id] ?? []).map((entry) => (
                          <div key={entry.msgId} style={{ marginBottom: 12 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 600, color: "#374151",
                              marginBottom: 6, paddingLeft: 2,
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                              <span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>📩</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>
                                {entry.preview}
                              </span>
                            </div>
                            <div style={{ paddingLeft: 18, borderLeft: "2px solid #e5e7eb", display: "flex", flexDirection: "column", gap: 5 }}>
                              {entry.branches.map((branch, bi) => {
                                const isPhase = branch.kind === "phase";
                                const isMsg   = branch.kind === "message";
                                const lc  = isPhase ? "#7c3aed" : isMsg ? "#c2410c" : "#6b7280";
                                const lbg = isPhase ? "#f5f3ff" : isMsg ? "#fff7ed" : "#f9fafb";
                                const lb  = isPhase ? "#e9d5ff" : isMsg ? "#fed7aa" : "#e5e7eb";
                                return (
                                  <div key={bi} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span style={{
                                      fontSize: 11, fontWeight: 700,
                                      color: lc, background: lbg, border: `1.5px solid ${lb}`,
                                      padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0,
                                    }}>
                                      {branch.label}
                                    </span>
                                    <span style={{ color: "#cbd5e1", fontSize: 13, flexShrink: 0 }}>→</span>
                                    {branch.kind === "phase" && (() => {
                                      const tp = phaseMap[branch.phaseId];
                                      const tm = tp ? PHASE_TYPE_META[tp.phase_type] : null;
                                      return tp && tm ? (
                                        <Link href={`/oas/${oaId}/works/${workId}/phases/${tp.id}`} style={{ textDecoration: "none" }}>
                                          <span style={{
                                            display: "inline-flex", alignItems: "center", gap: 5,
                                            fontSize: 11, fontWeight: 600,
                                            background: "#fff", border: `1.5px solid ${tm.border}`,
                                            color: "#111827", padding: "2px 9px", borderRadius: 20,
                                            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                          }}>
                                            <span style={{ fontSize: 9, fontWeight: 700, color: tm.color, background: tm.bg, padding: "1px 5px", borderRadius: 8 }}>
                                              {tm.label}
                                            </span>
                                            {tp.name}
                                          </span>
                                        </Link>
                                      ) : (
                                        <span style={{ fontSize: 11, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", padding: "2px 8px", borderRadius: 20 }}>フェーズなし</span>
                                      );
                                    })()}
                                    {branch.kind === "message" && (
                                      <span style={{
                                        display: "inline-flex", alignItems: "center", gap: 5,
                                        fontSize: 11, fontWeight: 500,
                                        background: "#fff7ed", border: "1.5px solid #fed7aa",
                                        color: "#92400e", padding: "2px 9px", borderRadius: 20,
                                        maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                      }}>
                                        <span style={{ fontSize: 9, flexShrink: 0 }}>💬</span>
                                        {branch.preview}
                                      </span>
                                    )}
                                    {branch.kind === "hint" && (
                                      <span style={{ fontSize: 11, color: "#a16207", background: "#fefce8", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: 20 }}>
                                        💡 ヒント
                                      </span>
                                    )}
                                    {branch.kind === "url" && (
                                      <span style={{ fontSize: 11, color: "#0369a1", background: "#f0f9ff", border: "1px solid #bae6fd", padding: "2px 8px", borderRadius: 20 }}>
                                        🔗 URL
                                      </span>
                                    )}
                                    {branch.kind === "text" && (
                                      <span style={{ fontSize: 11, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 20 }}>
                                        ✉ テキスト送信
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 遷移分岐ツリー */}
                    {outgoing.length > 0 && (
                      <div style={{
                        borderTop: "1px solid #f3f4f6",
                        background: "#fafafa",
                        padding: "10px 20px 12px 48px",
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", marginBottom: 8, letterSpacing: 0.4 }}>
                          🔀 遷移分岐
                        </div>
                        {outgoing.map((tr, trIdx) => {
                          const isLastBranch = trIdx === outgoing.length - 1;
                          const toPhase      = phaseMap[tr.to_phase_id];
                          const toMeta       = toPhase ? PHASE_TYPE_META[toPhase.phase_type] : null;
                          const bc           = branchColor(tr.label);
                          return (
                            <div key={tr.id} style={{ display: "flex", alignItems: "stretch", minHeight: 44 }}>
                              {/* ツリー線 */}
                              <div style={{ width: 22, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <div style={{ width: 2, flex: "0 0 18px", background: "#d1d5db" }} />
                                <div style={{ width: 2, flex: "0 0 2px", background: "#d1d5db", position: "relative" }}>
                                  <div style={{ position: "absolute", top: "50%", left: 0, width: 16, height: 2, background: "#d1d5db", transform: "translateY(-50%)" }} />
                                </div>
                                <div style={{ width: 2, flex: 1, background: isLastBranch ? "transparent" : "#d1d5db" }} />
                              </div>
                              {/* 分岐内容 */}
                              <div style={{ flex: 1, paddingLeft: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, paddingTop: 6, paddingBottom: 6 }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 700,
                                  color: bc.color, background: bc.bg, border: `1px solid ${bc.border}`,
                                  padding: "4px 12px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0,
                                }}>
                                  {tr.label}
                                </span>
                                <span style={{ color: "#9ca3af", fontSize: 16, flexShrink: 0, lineHeight: 1 }}>→</span>
                                {toPhase && toMeta ? (
                                  <Link href={`/oas/${oaId}/works/${workId}/phases/${toPhase.id}`} style={{ textDecoration: "none", flexShrink: 0 }}>
                                    <span style={{
                                      display: "inline-flex", alignItems: "center", gap: 6,
                                      fontSize: 13, fontWeight: 600, background: "#fff",
                                      border: `1.5px solid ${toMeta.border}`, color: "#111827",
                                      padding: "4px 12px", borderRadius: 20,
                                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                                    }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: toMeta.color, background: toMeta.bg, padding: "1px 6px", borderRadius: 10 }}>
                                        {toMeta.label}
                                      </span>
                                      {toPhase.name}
                                    </span>
                                  </Link>
                                ) : (
                                  <span style={{ fontSize: 12, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", padding: "3px 10px", borderRadius: 20 }}>
                                    遷移先なし
                                  </span>
                                )}
                                {tr.condition && (
                                  <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
                                    🔑 {tr.condition}
                                  </span>
                                )}
                                {tr.flag_condition && (
                                  <span style={{ fontSize: 11, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #e9d5ff", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
                                    🏷 {tr.flag_condition}
                                  </span>
                                )}
                                {!tr.is_active && (
                                  <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 6 }}>
                                    無効
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ── フッター導線 ── */}
                    <div style={{
                      borderTop: "1px solid #f3f4f6",
                      padding: "10px 12px",
                      display: "flex", gap: 8, alignItems: "center",
                      background: "#fafafa",
                    }}>
                      <Link
                        href={`/oas/${oaId}/works/${workId}/messages/new`}
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "5px 12px" }}
                      >
                        ＋ メッセージを追加
                      </Link>
                      <Link
                        href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "5px 12px" }}
                      >
                        詳細を開く →
                      </Link>
                    </div>
                  </>
                )}
              </div>

              {/* D&D ドロップインジケーター（下） */}
              {isDragOver && !dragAbove && (
                <div style={{ height: 3, borderRadius: 2, background: "#2563eb", margin: "2px 0" }} />
              )}

              {/* フェーズ間コネクター */}
              {!isLast && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0" }}>
                  <div style={{ width: 2, height: 16, background: "#d1d5db" }} />
                  <div style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid #d1d5db" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 凡例 */}
      <div style={{
        display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap", alignItems: "center",
        padding: "12px 16px", background: "#f9fafb",
        border: "1px solid #e5e7eb", borderRadius: 10,
        fontSize: 11, color: "#6b7280",
      }}>
        <span style={{ fontWeight: 600 }}>凡例：</span>
        {[
          { label: "正解", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
          { label: "不正解", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
          { label: "その他", color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" },
        ].map(({ label, color, bg, border }) => (
          <span key={label} style={{ fontSize: 11, fontWeight: 700, color, background: bg, border: `1px solid ${border}`, padding: "2px 10px", borderRadius: 20 }}>
            {label}
          </span>
        ))}
        <span style={{ marginLeft: 4, borderLeft: "1px solid #e5e7eb", paddingLeft: 12 }}>
          💬 メッセージ数　⤵ 分岐数
        </span>
        <span style={{ marginLeft: 4, borderLeft: "1px solid #e5e7eb", paddingLeft: 12, color: "#9ca3af" }}>
          ⠿ ドラッグで並び替え　▼ 展開　✏ 名前クリックで編集　種別バッジクリックで変更
        </span>
      </div>
    </div>
  );
}

// ── MetaChip — メタ情報アイコン＋数値 ──────────────
function MetaChip({ icon, value, label, linked }: { icon: string; value: number; label: string; linked?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 12, color: linked ? "#2563eb" : "#6b7280",
      padding: linked ? "2px 8px" : "0",
      borderRadius: linked ? 6 : 0,
      background: linked ? "#eff6ff" : "transparent",
      border: linked ? "1px solid #bfdbfe" : "none",
      transition: "background 0.15s",
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <strong style={{ color: linked ? "#1d4ed8" : "#374151", fontWeight: 700 }}>{value}</strong>
      <span>{label}</span>
      {linked && <span style={{ fontSize: 10, opacity: 0.7 }}>→</span>}
    </span>
  );
}
