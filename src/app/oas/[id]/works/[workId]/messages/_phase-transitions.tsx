// src/app/oas/[id]/works/[workId]/messages/_phase-transitions.tsx
// 「このメッセージの後の遷移」セクション
//
// ■ 表示内容
//   - 現在のメッセージが属するフェーズの「遷移アウト」一覧
//   - 種別バッジ（デフォルト / キーワード / フラグ条件 / 正解 / 不正解）
//   - 遷移先フェーズ名（インライン変更可）
// ■ 軽微編集
//   - 遷移先フェーズの変更 (to_phase_id)
//   - 遷移の新規追加（ラベル・宛先・条件キーワード）
//   - 遷移の削除
// ■ 主導線への誘導
//   - 「シナリオフローで詳細編集」リンク

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { transitionApi, getDevToken } from "@/lib/api-client";
import type { TransitionWithPhases, PhaseWithCounts } from "@/types";

// ── 種別ラベル・バッジ ────────────────────────────────────────────────────

interface KindInfo {
  label: string;
  bg:    string;
  color: string;
}

function getKindInfo(t: TransitionWithPhases): KindInfo {
  if (t.condition)       return { label: "キーワード",   bg: "#eff6ff", color: "#1d4ed8" };
  if (t.flag_condition)  return { label: "フラグ条件",   bg: "#f5f3ff", color: "#6d28d9" };
  const lower = t.label.toLowerCase();
  if (lower.includes("正解") && !lower.includes("不正解"))
                         return { label: "正解",          bg: "#f0fdf4", color: "#15803d" };
  if (lower.includes("不正解"))
                         return { label: "不正解",        bg: "#fff1f2", color: "#be123c" };
  return                        { label: "デフォルト",    bg: "#f3f4f6", color: "#374151" };
}

// ── フェーズ種別ラベル ────────────────────────────────────────────────────

const PHASE_TYPE_LABEL: Record<string, string> = {
  start:   "開始",
  normal:  "通常",
  ending:  "エンディング",
  global:  "共通",
};

function phaseLabel(p: Pick<PhaseWithCounts, "name" | "phase_type">): string {
  const type = PHASE_TYPE_LABEL[p.phase_type] ?? p.phase_type;
  return `${p.name}（${type}）`;
}

// ── 空のフォーム状態 ─────────────────────────────────────────────────────

interface AddForm {
  label:       string;
  to_phase_id: string;
  condition:   string;
  showCond:    boolean;
}

const EMPTY_ADD: AddForm = { label: "", to_phase_id: "", condition: "", showCond: false };

// ── props ────────────────────────────────────────────────────────────────

interface PhaseTransitionsSectionProps {
  oaId:    string;
  workId:  string;
  phaseId: string;
  phases:  PhaseWithCounts[];
}

// ── メインコンポーネント ─────────────────────────────────────────────────

export function PhaseTransitionsSection({
  oaId, workId, phaseId, phases,
}: PhaseTransitionsSectionProps) {

  const [transitions, setTransitions] = useState<TransitionWithPhases[]>([]);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);

  // インライン編集（遷移先変更）
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editDest,    setEditDest]    = useState("");
  const [saving,      setSaving]      = useState(false);

  // 削除
  const [deletingId,  setDeletingId]  = useState<string | null>(null);

  // 追加フォーム
  const [addForm,     setAddForm]     = useState<AddForm | null>(null);
  const [adding,      setAdding]      = useState(false);
  const addLabelRef = useRef<HTMLInputElement>(null);

  // ── フェッチ ────────────────────────────────────────────────────────────

  async function fetchTransitions() {
    if (!phaseId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const token = getDevToken();
      const data  = await transitionApi.list(token, { from_phase_id: phaseId });
      setTransitions(data);
    } catch {
      setLoadError("遷移の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTransitions([]);
    setEditingId(null);
    setAddForm(null);
    fetchTransitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseId]);

  // ── インライン編集（to_phase_id のみ） ────────────────────────────────

  function startEdit(t: TransitionWithPhases) {
    setEditingId(t.id);
    setEditDest(t.to_phase_id);
    setAddForm(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function commitEdit() {
    if (!editingId || !editDest) return;
    setSaving(true);
    try {
      const token   = getDevToken();
      const updated = await transitionApi.update(token, editingId, { to_phase_id: editDest });
      setTransitions((prev) =>
        prev.map((t) => t.id === editingId ? updated : t)
      );
      setEditingId(null);
    } catch {
      alert("遷移先の変更に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  // ── 削除 ──────────────────────────────────────────────────────────────

  async function deleteTransition(id: string) {
    if (!confirm("この遷移を削除しますか？")) return;
    setDeletingId(id);
    try {
      const token = getDevToken();
      await transitionApi.delete(token, id);
      setTransitions((prev) => prev.filter((t) => t.id !== id));
    } catch {
      alert("削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  }

  // ── 追加 ──────────────────────────────────────────────────────────────

  function openAddForm() {
    setAddForm({ ...EMPTY_ADD });
    setEditingId(null);
    requestAnimationFrame(() => addLabelRef.current?.focus());
  }

  function cancelAdd() {
    setAddForm(null);
  }

  async function commitAdd() {
    if (!addForm || !addForm.label.trim() || !addForm.to_phase_id) return;
    setAdding(true);
    try {
      const token   = getDevToken();
      const created = await transitionApi.create(token, {
        work_id:      workId,
        from_phase_id: phaseId,
        to_phase_id:   addForm.to_phase_id,
        label:         addForm.label.trim(),
        condition:     addForm.condition.trim() || undefined,
        sort_order:    transitions.length,
      });
      setTransitions((prev) => [...prev, created]);
      setAddForm(null);
    } catch {
      alert("遷移の追加に失敗しました");
    } finally {
      setAdding(false);
    }
  }

  // ── 派生値 ────────────────────────────────────────────────────────────

  // 遷移先として選べるフェーズ（現在のフェーズ自身は除く）
  const destPhases = phases.filter((p) => p.id !== phaseId);

  // ── レンダリング ───────────────────────────────────────────────────────

  if (!phaseId) return null;

  const scenarioHref = `/oas/${oaId}/works/${workId}/scenario`;

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        padding:      "14px 16px 12px",
        borderTop:    "3px solid #e0e7ff",
      }}
    >
      {/* ヘッダー */}
      <div style={{
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        marginBottom:   10,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
            このメッセージの後の遷移
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            このメッセージが属するフェーズからの遷移先。複雑な分岐はシナリオフローで管理できます。
          </div>
        </div>
        <Link
          href={scenarioHref}
          style={{
            fontSize:       11,
            fontWeight:     600,
            color:          "#6366f1",
            textDecoration: "none",
            display:        "flex",
            alignItems:     "center",
            gap:            3,
            flexShrink:     0,
            marginLeft:     12,
          }}
        >
          シナリオフローで詳細編集 →
        </Link>
      </div>

      {/* コンテンツ */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>
          <span className="spinner" style={{ width: 13, height: 13 }} />
          読み込み中…
        </div>
      ) : loadError ? (
        <div style={{ fontSize: 12, color: "#ef4444", padding: "4px 0" }}>
          {loadError}
          <button
            onClick={fetchTransitions}
            style={{ marginLeft: 8, fontSize: 11, color: "#6366f1", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            再読込
          </button>
        </div>
      ) : transitions.length === 0 && !addForm ? (
        <div style={{
          fontSize: 12,
          color:    "#9ca3af",
          padding:  "10px 12px",
          background: "#fafafa",
          borderRadius: 8,
          border:   "1px dashed #e5e7eb",
          marginBottom: 10,
        }}>
          遷移は未設定です ― このフェーズで会話が止まります。
        </div>
      ) : (
        <div style={{ marginBottom: transitions.length > 0 ? 10 : 0 }}>
          {transitions.map((t) => {
            const kind      = getKindInfo(t);
            const isEditing = editingId === t.id;
            const isDeleting = deletingId === t.id;
            const toPhase   = t.to_phase;

            return (
              <div
                key={t.id}
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          8,
                  padding:      "7px 10px",
                  borderRadius: 8,
                  marginBottom: 5,
                  background:   isEditing ? "#f5f3ff" : "#fafafa",
                  border:       `1px solid ${isEditing ? "#c4b5fd" : "#e5e7eb"}`,
                  flexWrap:     "wrap",
                }}
              >
                {/* 種別バッジ */}
                <span style={{
                  fontSize:     10,
                  fontWeight:   700,
                  padding:      "1px 6px",
                  borderRadius: 99,
                  background:   kind.bg,
                  color:        kind.color,
                  flexShrink:   0,
                  border:       `1px solid ${kind.color}33`,
                }}>
                  {kind.label}
                </span>

                {/* ラベル / 条件 */}
                <div style={{ flex: 1, minWidth: 80 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                    {t.label}
                  </span>
                  {t.condition && (
                    <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 5 }}>
                      「{t.condition}」
                    </span>
                  )}
                  {t.flag_condition && (
                    <span style={{ fontSize: 11, color: "#7c3aed", marginLeft: 5, fontFamily: "monospace" }}>
                      {t.flag_condition}
                    </span>
                  )}
                </div>

                {/* 矢印 */}
                <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>→</span>

                {/* 遷移先（表示 or 編集） */}
                {isEditing ? (
                  <select
                    value={editDest}
                    onChange={(e) => setEditDest(e.target.value)}
                    style={{
                      flex:         "1 1 160px",
                      fontSize:     12,
                      padding:      "4px 6px",
                      borderRadius: 6,
                      border:       "1.5px solid #a78bfa",
                      background:   "#fff",
                      color:        "#374151",
                    }}
                  >
                    <option value="">遷移先を選択</option>
                    {destPhases.map((p) => (
                      <option key={p.id} value={p.id}>{phaseLabel(p)}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{
                    fontSize:     12,
                    color:        "#374151",
                    fontWeight:   500,
                    flex:         "1 1 120px",
                    minWidth:     0,
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace:   "nowrap",
                  }}>
                    {toPhase ? phaseLabel(toPhase as PhaseWithCounts) : <span style={{ color: "#9ca3af" }}>（不明）</span>}
                  </span>
                )}

                {/* アクション群 */}
                {isEditing ? (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={commitEdit}
                      disabled={saving || !editDest}
                      style={{
                        fontSize:     11,
                        fontWeight:   700,
                        padding:      "3px 9px",
                        borderRadius: 6,
                        border:       "none",
                        cursor:       saving || !editDest ? "default" : "pointer",
                        background:   saving || !editDest ? "#e5e7eb" : "#6366f1",
                        color:        saving || !editDest ? "#9ca3af" : "#fff",
                      }}
                    >
                      {saving ? "…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      style={{
                        fontSize:     11,
                        padding:      "3px 8px",
                        borderRadius: 6,
                        border:       "1px solid #e5e7eb",
                        background:   "#fff",
                        color:        "#6b7280",
                        cursor:       "pointer",
                      }}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      title="遷移先を変更"
                      style={{
                        fontSize:     11,
                        padding:      "3px 8px",
                        borderRadius: 6,
                        border:       "1px solid #e5e7eb",
                        background:   "#fff",
                        color:        "#6b7280",
                        cursor:       "pointer",
                      }}
                    >
                      変更
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTransition(t.id)}
                      disabled={isDeleting}
                      title="この遷移を削除"
                      style={{
                        fontSize:     11,
                        padding:      "3px 8px",
                        borderRadius: 6,
                        border:       "1px solid #fecaca",
                        background:   "#fff",
                        color:        "#dc2626",
                        cursor:       isDeleting ? "default" : "pointer",
                        opacity:      isDeleting ? 0.5 : 1,
                      }}
                    >
                      {isDeleting ? "…" : "削除"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 追加フォーム */}
      {addForm && (
        <div style={{
          background:   "#f9fafb",
          border:       "1px solid #d1d5db",
          borderRadius: 10,
          padding:      "12px 14px",
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
            遷移を追加
          </div>

          {/* ラベル */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 3 }}>
              ラベル <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              ref={addLabelRef}
              type="text"
              value={addForm.label}
              onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
              placeholder="例: 次のフェーズへ、正解、キーワード一致 …"
              maxLength={200}
              style={{
                width:        "100%",
                fontSize:     12,
                padding:      "6px 8px",
                borderRadius: 6,
                border:       "1.5px solid #d1d5db",
                boxSizing:    "border-box",
              }}
            />
          </div>

          {/* 遷移先 */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 3 }}>
              遷移先フェーズ <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select
              value={addForm.to_phase_id}
              onChange={(e) => setAddForm({ ...addForm, to_phase_id: e.target.value })}
              style={{
                width:        "100%",
                fontSize:     12,
                padding:      "6px 8px",
                borderRadius: 6,
                border:       "1.5px solid #d1d5db",
                background:   "#fff",
                color:        "#374151",
                boxSizing:    "border-box",
              }}
            >
              <option value="">フェーズを選択</option>
              {destPhases.map((p) => (
                <option key={p.id} value={p.id}>{phaseLabel(p)}</option>
              ))}
            </select>
          </div>

          {/* 条件キーワード（トグル） */}
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setAddForm({ ...addForm, showCond: !addForm.showCond })}
              style={{
                fontSize:     11,
                color:        "#6366f1",
                background:   "none",
                border:       "none",
                cursor:       "pointer",
                padding:      0,
                fontWeight:   600,
              }}
            >
              {addForm.showCond ? "▾ 条件キーワードを隠す" : "▸ 条件キーワードを追加（任意）"}
            </button>
            {addForm.showCond && (
              <input
                type="text"
                value={addForm.condition}
                onChange={(e) => setAddForm({ ...addForm, condition: e.target.value })}
                placeholder="例: かいとう、answer （このキーワード受信時のみ遷移）"
                maxLength={500}
                style={{
                  width:        "100%",
                  marginTop:    6,
                  fontSize:     12,
                  padding:      "6px 8px",
                  borderRadius: 6,
                  border:       "1.5px solid #d1d5db",
                  boxSizing:    "border-box",
                }}
              />
            )}
            {!addForm.showCond && (
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>
                条件なし ＝ フェーズ終了時にデフォルトで遷移します
              </div>
            )}
          </div>

          {/* ボタン行 */}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={cancelAdd}
              disabled={adding}
              style={{
                fontSize:     12,
                padding:      "5px 12px",
                borderRadius: 6,
                border:       "1px solid #e5e7eb",
                background:   "#fff",
                color:        "#6b7280",
                cursor:       "pointer",
              }}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={commitAdd}
              disabled={adding || !addForm.label.trim() || !addForm.to_phase_id}
              style={{
                fontSize:     12,
                fontWeight:   700,
                padding:      "5px 14px",
                borderRadius: 6,
                border:       "none",
                cursor:       adding || !addForm.label.trim() || !addForm.to_phase_id ? "default" : "pointer",
                background:   adding || !addForm.label.trim() || !addForm.to_phase_id ? "#e5e7eb" : "#6366f1",
                color:        adding || !addForm.label.trim() || !addForm.to_phase_id ? "#9ca3af" : "#fff",
              }}
            >
              {adding ? "追加中…" : "追加"}
            </button>
          </div>
        </div>
      )}

      {/* フッターアクション */}
      {!addForm && (
        <button
          type="button"
          onClick={openAddForm}
          style={{
            fontSize:     12,
            fontWeight:   600,
            color:        "#6366f1",
            background:   "none",
            border:       "1.5px dashed #c7d2fe",
            borderRadius: 7,
            padding:      "6px 12px",
            cursor:       "pointer",
            width:        "100%",
            textAlign:    "center",
          }}
        >
          ＋ 遷移を追加
        </button>
      )}
    </div>
  );
}
