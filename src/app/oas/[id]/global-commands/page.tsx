"use client";

// src/app/oas/[id]/global-commands/page.tsx
// グローバルコマンド管理 — 一覧 + インライン追加フォーム

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { oaApi, globalCommandApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import type { GlobalCommand, GlobalCommandActionType } from "@/types";

// ── アクション種別のメタ情報 ───────────────────────────────
const ACTION_META: Record<GlobalCommandActionType, {
  label: string;
  icon:  string;
  desc:  string;
  bg:    string;
  color: string;
}> = {
  HINT:   { label: "ヒント表示",   icon: "💡", desc: "現在フェーズのパズルヒントを表示します",               bg: "#fef3c7", color: "#92400e" },
  RESET:  { label: "リセット",     icon: "🔄", desc: "プレイ状態を初期化して最初からやり直します",            bg: "#fef2f2", color: "#991b1b" },
  HELP:   { label: "ヘルプ表示",   icon: "❓", desc: "payload に設定したガイドテキストを返します",            bg: "#eff6ff", color: "#1d4ed8" },
  REPEAT: { label: "メッセージ再送", icon: "↩️", desc: "現在フェーズのメッセージを再送します",               bg: "#f0fdf4", color: "#166534" },
  CUSTOM: { label: "カスタム返信",  icon: "✉️", desc: "payload に設定した任意テキストを返信します",          bg: "#f5f3ff", color: "#7e22ce" },
};

const ACTION_OPTIONS = (Object.keys(ACTION_META) as GlobalCommandActionType[]).map((k) => ({
  value: k,
  ...ACTION_META[k],
}));

interface CommandForm {
  keyword:     string;
  action_type: GlobalCommandActionType;
  payload:     string;
  is_active:   boolean;
  sort_order:  number;
}

const EMPTY_FORM: CommandForm = {
  keyword:     "",
  action_type: "HINT",
  payload:     "",
  is_active:   true,
  sort_order:  0,
};

// payload が必要なアクション種別
const NEEDS_PAYLOAD: GlobalCommandActionType[] = ["CUSTOM", "HELP"];

export default function GlobalCommandsPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]         = useState("");
  const [commands, setCommands]       = useState<GlobalCommand[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm]         = useState<CommandForm>(EMPTY_FORM);
  const [addErrors, setAddErrors]     = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);
  const [togglingId, setTogglingId]   = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, list] = await Promise.all([
        oaApi.get(token, oaId),
        globalCommandApi.list(token, oaId),
      ]);
      setOaTitle(oa.title);
      setCommands(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]);

  function validate(form: CommandForm): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.keyword.trim()) errs.keyword = "キーワードを入力してください";
    if (form.action_type === "CUSTOM" && !form.payload.trim()) {
      errs.payload = "CUSTOM アクションにはメッセージテキストが必要です";
    }
    return errs;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(addForm);
    if (Object.keys(errs).length) { setAddErrors(errs); return; }
    setSaving(true);
    try {
      await globalCommandApi.create(getDevToken(), {
        oa_id:       oaId,
        keyword:     addForm.keyword.trim(),
        action_type: addForm.action_type,
        payload:     addForm.payload.trim() || null,
        is_active:   addForm.is_active,
        sort_order:  addForm.sort_order,
      });
      showToast(`「${addForm.keyword.trim()}」を追加しました`, "success");
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      setAddErrors({});
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "追加に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(cmd: GlobalCommand) {
    setTogglingId(cmd.id);
    try {
      await globalCommandApi.update(getDevToken(), cmd.id, { is_active: !cmd.is_active });
      showToast(`「${cmd.keyword}」を${!cmd.is_active ? "有効" : "無効"}にしました`, "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新に失敗しました", "error");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(cmd: GlobalCommand) {
    if (!confirm(`「${cmd.keyword}」を削除しますか？`)) return;
    setDeletingId(cmd.id);
    try {
      await globalCommandApi.delete(getDevToken(), cmd.id);
      showToast(`「${cmd.keyword}」を削除しました`, "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    } finally {
      setDeletingId(null);
    }
  }

  const showPayloadField = NEEDS_PAYLOAD.includes(addForm.action_type);

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト",   href: "/oas" },
            { label: oaTitle || "…",       href: `/oas/${oaId}/settings` },
            { label: "共通メッセージ" },
          ]} />
          <h2>共通メッセージ</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            フェーズに関係なく反応する共通キーワードとメッセージを設定します
          </p>
        </div>
        {!showAddForm && (
          <button
            className="btn btn-primary"
            onClick={() => { setShowAddForm(true); setAddForm(EMPTY_FORM); setAddErrors({}); }}
          >
            ＋ 共通メッセージを追加
          </button>
        )}
      </div>

      {/* ── ヘルプ ── */}
      <HelpAccordion items={[
        { icon: "✅", title: "共通メッセージとは？", points: [
          "通常の遷移ロジックより「最優先」で評価されるキーワードです",
          "どのフェーズにいても「ヒント」「ヘルプ」などに反応できます",
          "Webhook 処理順序: ① 共通メッセージ → ② フェーズ遷移 → ③ fallback",
        ]},
        { icon: "🎯", title: "アクション種別", points: [
          "HINT — 現在フェーズのパズルヒントテキストを表示（puzzleHintText フィールド）",
          "RESET — ユーザーの進行状態をリセットして最初から開始",
          "HELP — payload に設定したガイドテキストを返信",
          "REPEAT — 現在フェーズのメッセージを再送信",
          "CUSTOM — payload に設定した任意テキストを返信",
        ]},
        { icon: "💡", title: "キーワードの照合", points: [
          "NFKC 正規化（全角→半角）後に完全一致で判定します",
          "末尾の句読点（。！？）は無視されます",
          "将来的に synonyms（複数キーワード）/ 部分一致も拡張予定です",
        ]},
      ]} />

      {/* ── エラー ── */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* ── 追加フォーム ── */}
      {showAddForm && (
        <div className="card" style={{ maxWidth: 600, marginBottom: 16, borderColor: "var(--color-info)", borderWidth: 2 }}>
          <p style={{ fontWeight: 700, fontSize: 13, color: "var(--color-info)", marginBottom: 14 }}>
            ＋ 新しい共通メッセージを追加
          </p>
          <form onSubmit={handleAdd}>
            {/* キーワード */}
            <div className="form-group">
              <label htmlFor="add-keyword">
                キーワード <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="add-keyword"
                type="text"
                value={addForm.keyword}
                onChange={(e) => { setAddForm({ ...addForm, keyword: e.target.value }); setAddErrors({}); }}
                placeholder="例: ヒント、やめる、ヘルプ"
                maxLength={100}
                autoFocus
              />
              {addErrors.keyword && <p className="field-error">{addErrors.keyword}</p>}
            </div>

            {/* アクション種別 */}
            <div className="form-group">
              <label>アクション種別 <span style={{ color: "#ef4444" }}>*</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                {ACTION_OPTIONS.map(({ value, label, icon, desc, bg, color }) => (
                  <label key={value} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    cursor: "pointer",
                    padding: "10px 14px",
                    background: addForm.action_type === value ? bg : "var(--gray-50)",
                    border: `1.5px solid ${addForm.action_type === value ? color : "var(--border-light)"}`,
                    borderRadius: "var(--radius-sm)",
                    transition: "background 0.1s, border-color 0.1s",
                  }}>
                    <input
                      type="radio"
                      name="add-action-type"
                      value={value}
                      checked={addForm.action_type === value}
                      onChange={() => setAddForm({ ...addForm, action_type: value as GlobalCommandActionType, payload: "" })}
                      style={{ marginTop: 2 }}
                    />
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 13, color: addForm.action_type === value ? color : "var(--text-primary)" }}>
                        {label}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginTop: 1 }}>
                        {desc}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* payload（CUSTOM / HELP のみ） */}
            {showPayloadField && (
              <div className="form-group">
                <label htmlFor="add-payload">
                  メッセージテキスト
                  {addForm.action_type === "CUSTOM" && <span style={{ color: "#ef4444" }}> *</span>}
                </label>
                <textarea
                  id="add-payload"
                  value={addForm.payload}
                  onChange={(e) => { setAddForm({ ...addForm, payload: e.target.value }); setAddErrors({}); }}
                  placeholder={
                    addForm.action_type === "CUSTOM"
                      ? "LINE に返信するテキストを入力してください"
                      : "ヘルプガイドのテキストを入力（省略時はデフォルト文）"
                  }
                  maxLength={2000}
                  style={{ minHeight: 80 }}
                />
                {addErrors.payload && <p className="field-error">{addErrors.payload}</p>}
              </div>
            )}

            {/* 順序・有効フラグ */}
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div className="form-group" style={{ flexShrink: 0 }}>
                <label htmlFor="add-sort">優先順序</label>
                <input
                  id="add-sort"
                  type="number"
                  value={addForm.sort_order}
                  onChange={(e) => setAddForm({ ...addForm, sort_order: Number(e.target.value) })}
                  min={0}
                  style={{ width: 90 }}
                />
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={addForm.is_active}
                    onChange={(e) => setAddForm({ ...addForm, is_active: e.target.checked })}
                    style={{ width: "auto" }}
                  />
                  有効にする
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddForm(false)}>
                キャンセル
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving && <span className="spinner" />}
                {saving ? "追加中..." : "追加する"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── 一覧 ── */}
      {loading ? (
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)", display: "flex", gap: 16, alignItems: "center" }}>
              <div className="skeleton" style={{ width: 60, height: 24, borderRadius: 12 }} />
              <div className="skeleton" style={{ width: 100, height: 16 }} />
              <div className="skeleton" style={{ flex: 1, height: 13 }} />
              <div className="skeleton" style={{ width: 100, height: 28, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      ) : commands.length === 0 && !showAddForm ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">⌨️</div>
            <p className="empty-state-title">共通メッセージがまだありません</p>
            <p className="empty-state-desc">
              「ヒント」「ヘルプ」などのキーワードとアクションを登録すると、<br />
              どのフェーズでも共通で反応するようになります。
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              onClick={() => { setShowAddForm(true); setAddErrors({}); }}
            >
              ＋ 最初の共通メッセージを追加
            </button>
          </div>
        </div>
      ) : commands.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--gray-50)", borderBottom: "1px solid var(--border)" }}>
                {["キーワード", "アクション", "メッセージ / 説明", "状態", ""].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontWeight: 600, fontSize: 11, color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd) => {
                const meta = ACTION_META[cmd.action_type as GlobalCommandActionType] ?? ACTION_META.CUSTOM;
                return (
                  <tr
                    key={cmd.id}
                    style={{ borderBottom: "1px solid var(--border-light)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--gray-50)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {/* キーワード */}
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <code style={{
                        fontFamily: "monospace",
                        fontSize: 14, fontWeight: 700,
                        color: cmd.is_active ? "var(--text-primary)" : "var(--text-muted)",
                        background: cmd.is_active ? "var(--gray-100)" : "transparent",
                        padding: "2px 8px", borderRadius: 4,
                      }}>
                        {cmd.keyword}
                      </code>
                      {!cmd.is_active && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>
                          （無効）
                        </span>
                      )}
                    </td>

                    {/* アクション */}
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, fontWeight: 700,
                        background: meta.bg, color: meta.color,
                        padding: "3px 10px", borderRadius: "var(--radius-full)",
                      }}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>

                    {/* payload / 説明 */}
                    <td style={{ padding: "14px 16px", maxWidth: 300, color: "var(--text-secondary)", fontSize: 12 }}>
                      {cmd.payload ? (
                        <span style={{
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical", overflow: "hidden",
                          wordBreak: "break-all",
                        }}>
                          {cmd.payload}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>{meta.desc}</span>
                      )}
                    </td>

                    {/* 状態 */}
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 9px", borderRadius: "var(--radius-full)",
                        fontSize: 11, fontWeight: 700,
                        background: cmd.is_active ? "#dcfce7" : "var(--gray-100)",
                        color:      cmd.is_active ? "#166534" : "var(--text-muted)",
                      }}>
                        {cmd.is_active
                          ? <><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />有効</>
                          : "無効"
                        }
                      </span>
                    </td>

                    {/* アクション */}
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        <Link
                          href={`/oas/${oaId}/global-commands/${cmd.id}/edit`}
                          className="btn btn-ghost"
                          style={{ padding: "5px 12px", fontSize: 12 }}
                        >
                          編集
                        </Link>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "5px 12px", fontSize: 12 }}
                          disabled={togglingId === cmd.id}
                          onClick={() => handleToggleActive(cmd)}
                        >
                          {togglingId === cmd.id
                            ? <span className="spinner" />
                            : cmd.is_active ? "無効化" : "有効化"
                          }
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: "5px 10px", fontSize: 12 }}
                          disabled={deletingId === cmd.id}
                          onClick={() => handleDelete(cmd)}
                        >
                          {deletingId === cmd.id ? <span className="spinner" /> : "削除"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px", fontSize: 11, color: "var(--text-muted)", textAlign: "right", borderTop: "1px solid var(--border-light)" }}>
            {commands.length} 件
          </div>
        </div>
      )}
    </>
  );
}
