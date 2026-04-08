"use client";

// _node-graph/panels/RightPanel.tsx — 遷移編集パネル（既存RightPanelをほぼそのまま抽出）

import { useState } from "react";
import { TLink as Link } from "@/components/TLink";
import type {
  PhaseWithCounts,
  TransitionWithPhases,
  CreateTransitionBody,
  UpdateTransitionBody,
} from "@/types";
import { transitionApi, getDevToken } from "@/lib/api-client";
import { PHASE_META } from "../constants";

interface RightPanelProps {
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
}

export function RightPanel({
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
}: RightPanelProps) {
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
        work_id:       workId,
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
                fontSize: 10, color: "#2563eb", textDecoration: "none",
                padding: "2px 8px", border: "1px solid #bfdbfe",
                borderRadius: 4, background: "#eff6ff",
              }}
            >
              フェーズ詳細
            </Link>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 18, color: "#9ca3af", padding: "2px 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* 遷移リスト */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 8 }}>
          遷移 ({outgoing.length})
        </div>

        {outgoing.length === 0 && (
          <div style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>
            遷移がありません
          </div>
        )}

        {outgoing.map(t => {
          const isEditing = editingTid === t.id;
          const isFocused = focusedTransitionId === t.id;
          return (
            <div
              key={t.id}
              style={{
                marginBottom: 8, padding: "8px 10px",
                border: isFocused ? "2px solid #2563eb" : "1px solid #e5e7eb",
                borderRadius: 8, background: isFocused ? "#eff6ff" : "#f9fafb",
              }}
            >
              {isEditing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    placeholder="ラベル"
                    style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
                  />
                  <select
                    value={editToPhaseId}
                    onChange={e => setEditToPhaseId(e.target.value)}
                    style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 6px" }}
                  >
                    <option value="">遷移先を選択</option>
                    {otherPhases.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleSaveEdit(t.id)}
                      disabled={editSaving}
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
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                    → {t.to_phase?.name ?? t.to_phase_id}
                  </div>
                  {t.condition && (
                    <div style={{ fontSize: 10, color: "#1d4ed8", marginTop: 2 }}>
                      🔑 {t.condition}
                    </div>
                  )}
                  {t.flag_condition && (
                    <div style={{ fontSize: 10, color: "#6d28d9", marginTop: 2 }}>
                      ⚑ {t.flag_condition}
                    </div>
                  )}
                  {canEdit && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                      <button
                        onClick={() => startEdit(t)}
                        style={{
                          fontSize: 10, padding: "2px 8px",
                          background: "none", color: "#2563eb",
                          border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deletingTid === t.id}
                        style={{
                          fontSize: 10, padding: "2px 8px",
                          background: "none", color: "#dc2626",
                          border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        {deletingTid === t.id ? "削除中…" : "削除"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 遷移追加 */}
        {canEdit && phase.phase_type !== "ending" && (
          <div style={{ marginTop: 8 }}>
            {!addOpen ? (
              <button
                onClick={() => setAddOpen(true)}
                style={{
                  fontSize: 11, padding: "6px 12px",
                  background: "#eff6ff", color: "#2563eb",
                  border: "1px solid #bfdbfe", borderRadius: 6, cursor: "pointer",
                  fontWeight: 600, width: "100%",
                }}
              >
                ＋ 遷移を追加
              </button>
            ) : (
              <div style={{
                padding: "10px", border: "1px solid #bfdbfe",
                borderRadius: 8, background: "#f0f9ff",
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <input
                  autoFocus
                  value={addLabel}
                  onChange={e => setAddLabel(e.target.value)}
                  placeholder="ラベル（例: 正解、不正解）"
                  style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px" }}
                />
                <select
                  value={addToPhaseId}
                  onChange={e => setAddToPhaseId(e.target.value)}
                  style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 6px" }}
                >
                  <option value="">遷移先フェーズを選択</option>
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
                    onClick={() => {
                      setAddOpen(false); setAddLabel(""); setAddToPhaseId("");
                      setAddCondition(""); setAddFlagCond(""); setAddShowCond(false);
                    }}
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
