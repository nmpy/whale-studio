"use client";

// src/app/oas/[id]/works/[workId]/phases/page.tsx
// フェーズ一覧

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { workApi, phaseApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import type { PhaseWithCounts, PhaseType } from "@/types";

const PHASE_TYPE_META: Record<PhaseType, { label: string; color: string; bg: string }> = {
  start:  { label: "開始",         color: "#16a34a", bg: "#f0fdf4" },
  normal: { label: "通常",         color: "#2563eb", bg: "#eff6ff" },
  ending: { label: "エンディング", color: "#9333ea", bg: "#faf5ff" },
};

const PHASE_TYPE_OPTIONS: { value: PhaseType; label: string; color: string; bg: string }[] = [
  { value: "start",   label: "開始",         color: "#16a34a", bg: "#f0fdf4" },
  { value: "normal",  label: "通常",         color: "#2563eb", bg: "#eff6ff" },
  { value: "ending",  label: "エンディング", color: "#9333ea", bg: "#faf5ff" },
];

interface PhaseForm {
  phase_type:  PhaseType;
  name:        string;
  description: string;
  sort_order:  number;
  is_active:   boolean;
}

const EMPTY_PHASE_FORM: PhaseForm = {
  phase_type: "normal", name: "", description: "", sort_order: 0, is_active: true,
};

export default function PhasesPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { showToast } = useToast();

  const [workTitle, setWorkTitle] = useState("");
  const [phases, setPhases]       = useState<PhaseWithCounts[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm]         = useState<PhaseForm>(EMPTY_PHASE_FORM);
  const [addErrors, setAddErrors]     = useState<Record<string, string[]>>({});
  const [addingPhase, setAddingPhase] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const token = getDevToken();
      const [w, list] = await Promise.all([
        workApi.get(token, workId),
        phaseApi.list(token, workId),
      ]);
      setWorkTitle(w.title);
      setPhases(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [workId]);

  const hasStartPhase = phases.some((p) => p.phase_type === "start");

  async function handleAddPhase(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string[]> = {};
    if (!addForm.name.trim()) errs.name = ["フェーズ名を入力してください"];
    if (Object.keys(errs).length) { setAddErrors(errs); return; }
    setAddingPhase(true);
    try {
      await phaseApi.create(getDevToken(), {
        work_id:     workId,
        phase_type:  addForm.phase_type,
        name:        addForm.name.trim(),
        description: addForm.description.trim() || undefined,
        sort_order:  addForm.sort_order,
        is_active:   addForm.is_active,
      });
      showToast(`「${addForm.name.trim()}」を追加しました`, "success");
      setAddForm(EMPTY_PHASE_FORM);
      setShowAddForm(false);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "追加に失敗しました";
      showToast(msg, "error");
      if (msg.includes("開始フェーズ")) setAddErrors({ phase_type: [msg] });
    } finally {
      setAddingPhase(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>フェーズ管理</h2>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", display: "flex", gap: 16 }}>
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
              <div className="skeleton" style={{ flex: 1,   height: 14 }} />
              <div className="skeleton" style={{ width: 80,  height: 14 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <h2>フェーズ管理</h2>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
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
            { label: "フェーズ管理" },
          ]} />
          <h2>フェーズ管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            シナリオの進行段階（フェーズ）を管理します。
          </p>
        </div>
        {!showAddForm && (
          <button
            className="btn btn-primary"
            onClick={() => { setShowAddForm(true); setAddForm(EMPTY_PHASE_FORM); setAddErrors({}); }}
          >
            + フェーズを追加
          </button>
        )}
      </div>

      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "物語の進行単位「フェーズ」を作成・管理します",
          "開始（start）・通常（normal）・エンディング（ending）の3種別があります",
        ]},
        { icon: "👆", title: "まず最初に決めること", points: [
          "「開始」フェーズを必ず1つ作ってください（シナリオ開始時に表示されます）",
          "「エンディング」フェーズをゴールとして設定します",
          "通常フェーズで謎や選択肢を挟みます",
        ]},
        { icon: "🗺", title: "遷移の設定", points: [
          "フェーズ間のつながりはシナリオフロー画面で設定します",
          "遷移のないフェーズにはユーザーが行き詰まるので注意",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "フェーズを削除するとメッセージの紐づけが外れます",
          "有効フラグがオフのフェーズはシナリオ上で無視されます",
        ]},
      ]} />

      {/* ── フェーズ追加フォーム ── */}
      {showAddForm && (
        <div className="card" style={{ maxWidth: 640, marginBottom: 16, borderColor: "#2563eb", borderWidth: 2 }}>
          <p style={{ fontWeight: 600, marginBottom: 12, color: "#2563eb", fontSize: 13 }}>
            新しいフェーズを追加
          </p>
          <form onSubmit={handleAddPhase}>
            <div className="form-group">
              <label>フェーズ種別 <span style={{ color: "#ef4444" }}>*</span></label>
              <div className="radio-group">
                {PHASE_TYPE_OPTIONS.map(({ value, label, color, bg }) => {
                  const disabled = value === "start" && hasStartPhase;
                  return (
                    <label key={value} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      opacity: disabled ? 0.45 : 1,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}>
                      <input type="radio" name="add-phase-type" value={value}
                        checked={addForm.phase_type === value}
                        disabled={disabled}
                        onChange={() => !disabled && setAddForm({ ...addForm, phase_type: value })} />
                      <span style={{ fontSize: 12, fontWeight: 600, color, background: bg, padding: "2px 8px", borderRadius: 10 }}>
                        {label}
                      </span>
                      {disabled && <span style={{ fontSize: 11, color: "#9ca3af" }}>（既に存在）</span>}
                    </label>
                  );
                })}
              </div>
              {addErrors.phase_type?.map((m) => <p key={m} className="field-error">{m}</p>)}
            </div>

            <div className="form-group">
              <label htmlFor="add-name">フェーズ名 <span style={{ color: "#ef4444" }}>*</span></label>
              <input id="add-name" type="text" value={addForm.name}
                onChange={(e) => { setAddForm({ ...addForm, name: e.target.value }); setAddErrors({}); }}
                placeholder="例: 序章 / 謎解きパート / 真相エンド" maxLength={100} autoFocus />
              {addErrors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
            </div>

            <div className="form-group">
              <label htmlFor="add-desc">説明（任意）</label>
              <textarea id="add-desc" value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                placeholder="このフェーズで起こることを簡単に記述" maxLength={500} style={{ minHeight: 56 }} />
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div className="form-group" style={{ flexShrink: 0 }}>
                <label htmlFor="add-sort">順序</label>
                <input id="add-sort" type="number" value={addForm.sort_order}
                  onChange={(e) => setAddForm({ ...addForm, sort_order: Number(e.target.value) })}
                  min={0} style={{ width: 90 }} />
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                  <input type="checkbox" checked={addForm.is_active}
                    onChange={(e) => setAddForm({ ...addForm, is_active: e.target.checked })}
                    style={{ width: "auto" }} />
                  有効にする
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddForm(false)}>
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

      {/* ── 一覧 ── */}
      {phases.length === 0 && !showAddForm ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🗂</div>
            <p className="empty-state-title">フェーズがまだありません</p>
            <p className="empty-state-desc">
              まず「開始」フェーズを作成し、「通常」「エンディング」へ遷移を繋ぎましょう。
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 8, display: "inline-block" }}
              onClick={() => { setShowAddForm(true); setAddErrors({}); }}
            >
              + 最初のフェーズを作成
            </button>
          </div>
        </div>
      ) : phases.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e5e5", background: "#f9fafb" }}>
                {["タイプ", "フェーズ名", "説明", "メッセ", "遷移", "状態", ""].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "10px 14px", textAlign: "left",
                      fontWeight: 600, color: "#374151", fontSize: 12, whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {phases
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((phase) => {
                  const meta = PHASE_TYPE_META[phase.phase_type];
                  return (
                    <tr
                      key={phase.id}
                      style={{ borderBottom: "1px solid #f3f4f6" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      {/* タイプ */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 12,
                          fontSize: 11, fontWeight: 600,
                          background: meta.bg, color: meta.color,
                        }}>
                          {meta.label}
                        </span>
                      </td>

                      {/* フェーズ名 */}
                      <td style={{ padding: "12px 14px", fontWeight: 500, color: "#111827" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <span>{phase.name}</span>
                          {phase.phase_type === "start" && (
                            phase.start_trigger ? (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                fontSize: 10, fontWeight: 600, color: "#065f46",
                                background: "#d1fae5", border: "1px solid #6ee7b7",
                                borderRadius: 8, padding: "1px 6px", width: "fit-content",
                              }}>
                                🔑 {phase.start_trigger}
                              </span>
                            ) : (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                fontSize: 10, color: "#9ca3af",
                                background: "#f3f4f6", borderRadius: 8,
                                padding: "1px 6px", width: "fit-content",
                              }}>
                                🔑 トリガー未設定（自動開始）
                              </span>
                            )
                          )}
                        </div>
                      </td>

                      {/* 説明 */}
                      <td style={{ padding: "12px 14px", maxWidth: 240, color: "#6b7280" }}>
                        <span style={{
                          display: "-webkit-box", WebkitLineClamp: 1,
                          WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                          {phase.description || "—"}
                        </span>
                      </td>

                      {/* メッセ数 */}
                      <td style={{ padding: "12px 14px", textAlign: "center", color: "#6b7280" }}>
                        {phase._count.messages}
                      </td>

                      {/* 遷移数 */}
                      <td style={{ padding: "12px 14px", textAlign: "center", color: "#6b7280" }}>
                        {phase._count.transitionsFrom}
                      </td>

                      {/* 状態 */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 12,
                          fontSize: 11, fontWeight: 600,
                          background: phase.is_active ? "#dcfce7" : "#f3f4f6",
                          color:      phase.is_active ? "#16a34a" : "#6b7280",
                        }}>
                          {phase.is_active ? "有効" : "無効"}
                        </span>
                      </td>

                      {/* 編集 */}
                      <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <Link
                          href={`/oas/${oaId}/works/${workId}/phases/${phase.id}`}
                          className="btn btn-ghost"
                          style={{ padding: "4px 12px", fontSize: 12 }}
                        >
                          詳細
                        </Link>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div style={{ padding: "8px 14px", fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
            {phases.length} 件
          </div>
        </div>
      )}
    </>
  );
}
