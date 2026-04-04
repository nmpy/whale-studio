"use client";

// src/app/oas/[id]/global-commands/[commandId]/edit/page.tsx
// グローバルコマンド編集ページ

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { oaApi, globalCommandApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import type { GlobalCommandActionType } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

const ACTION_META: Record<GlobalCommandActionType, {
  label: string; icon: string; desc: string; bg: string; color: string;
}> = {
  HINT:   { label: "ヒント表示",    icon: "💡", desc: "現在フェーズのパズルヒントを表示",            bg: "#fef3c7", color: "#92400e" },
  RESET:  { label: "リセット",      icon: "🔄", desc: "プレイ状態をリセットして最初から",            bg: "#fef2f2", color: "#991b1b" },
  HELP:   { label: "ヘルプ表示",    icon: "❓", desc: "payload のガイドテキストを返信",              bg: "#eff6ff", color: "#1d4ed8" },
  REPEAT: { label: "メッセージ再送", icon: "↩️", desc: "現在フェーズのメッセージを再送",             bg: "#f0fdf4", color: "#166534" },
  CUSTOM: { label: "カスタム返信",   icon: "✉️", desc: "payload の任意テキストを返信",               bg: "#f5f3ff", color: "#7e22ce" },
};

const ACTION_OPTIONS = (Object.keys(ACTION_META) as GlobalCommandActionType[]).map((k) => ({
  value: k,
  ...ACTION_META[k],
}));

const NEEDS_PAYLOAD: GlobalCommandActionType[] = ["CUSTOM", "HELP"];

export default function GlobalCommandEditPage() {
  const params    = useParams<{ id: string; commandId: string }>();
  const oaId      = params.id;
  const commandId = params.commandId;
  const router    = useRouter();
  const { showToast } = useToast();

  const { role, canEdit } = useWorkspaceRole(oaId);

  const [oaTitle,  setOaTitle]  = useState("");
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors,   setErrors]   = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    keyword:     "",
    action_type: "HINT" as GlobalCommandActionType,
    payload:     "",
    is_active:   true,
    sort_order:  0,
  });

  // 初期値読み込み
  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      oaApi.get(token, oaId),
      globalCommandApi.get(token, commandId),
    ])
      .then(([oa, cmd]) => {
        setOaTitle(oa.title);
        setForm({
          keyword:     cmd.keyword,
          action_type: cmd.action_type,
          payload:     cmd.payload ?? "",
          is_active:   cmd.is_active,
          sort_order:  cmd.sort_order,
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [oaId, commandId]);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.keyword.trim()) errs.keyword = "キーワードを入力してください";
    if (form.action_type === "CUSTOM" && !form.payload.trim()) {
      errs.payload = "CUSTOM アクションにはメッセージテキストが必要です";
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await globalCommandApi.update(getDevToken(), commandId, {
        keyword:     form.keyword.trim(),
        action_type: form.action_type,
        payload:     form.payload.trim() || null,
        is_active:   form.is_active,
        sort_order:  form.sort_order,
      });
      showToast("保存しました", "success");
      router.push(`/oas/${oaId}/global-commands`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`「${form.keyword}」を削除しますか？`)) return;
    setDeleting(true);
    try {
      await globalCommandApi.delete(getDevToken(), commandId);
      showToast("削除しました", "success");
      router.push(`/oas/${oaId}/global-commands`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    } finally {
      setDeleting(false);
    }
  }

  const showPayloadField = NEEDS_PAYLOAD.includes(form.action_type);

  if (loading) {
    return (
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 240, height: 13, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 200, height: 22 }} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <h2>コマンド編集</h2>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト",   href: "/oas" },
            { label: oaTitle || "…",       href: `/oas/${oaId}/settings` },
            { label: "共通メッセージ", href: `/oas/${oaId}/global-commands` },
            { label: form.keyword || "編集" },
          ]} />
          <h2>コマンドを編集</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            キーワードとアクションを変更します
          </p>
        </div>
        <button
          className="btn btn-danger"
          style={{ padding: "7px 14px", fontSize: 12 }}
          disabled={deleting}
          onClick={handleDelete}
        >
          {deleting && <span className="spinner" />}
          削除
        </button>
      </div>

      <div className="card" style={{ maxWidth: 600 }}>
        <form onSubmit={handleSubmit}>
          {/* キーワード */}
          <div className="form-group">
            <label htmlFor="keyword">
              キーワード <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="keyword"
              type="text"
              value={form.keyword}
              onChange={(e) => { setForm({ ...form, keyword: e.target.value }); setErrors({}); }}
              placeholder="例: ヒント、やめる、ヘルプ"
              maxLength={100}
              readOnly={!canEdit}
            />
            {errors.keyword && <p className="field-error">{errors.keyword}</p>}
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
                  background: form.action_type === value ? bg : "var(--gray-50)",
                  border: `1.5px solid ${form.action_type === value ? color : "var(--border-light)"}`,
                  borderRadius: "var(--radius-sm)",
                  transition: "background 0.1s, border-color 0.1s",
                }}>
                  <input
                    type="radio"
                    name="action-type"
                    value={value}
                    checked={form.action_type === value}
                    onChange={() => setForm({ ...form, action_type: value as GlobalCommandActionType, payload: "" })}
                    style={{ marginTop: 2 }}
                    disabled={!canEdit}
                  />
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: form.action_type === value ? color : "var(--text-primary)" }}>
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
              <label htmlFor="payload">
                メッセージテキスト
                {form.action_type === "CUSTOM" && <span style={{ color: "#ef4444" }}> *</span>}
              </label>
              <textarea
                id="payload"
                value={form.payload}
                onChange={(e) => { setForm({ ...form, payload: e.target.value }); setErrors({}); }}
                placeholder={
                  form.action_type === "CUSTOM"
                    ? "LINE に返信するテキストを入力してください"
                    : "ヘルプガイドのテキストを入力（省略時はデフォルト文）"
                }
                maxLength={2000}
                style={{ minHeight: 80 }}
                readOnly={!canEdit}
              />
              {errors.payload && <p className="field-error">{errors.payload}</p>}
            </div>
          )}

          {/* 順序・有効フラグ */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div className="form-group" style={{ flexShrink: 0 }}>
              <label htmlFor="sort-order">優先順序</label>
              <input
                id="sort-order"
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                min={0}
                style={{ width: 90 }}
                readOnly={!canEdit}
              />
            </div>
            <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  style={{ width: "auto" }}
                  disabled={!canEdit}
                />
                有効にする
              </label>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => router.push(`/oas/${oaId}/global-commands`)}
            >
              キャンセル
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canEdit || saving}>
              {saving && <span className="spinner" />}
              {saving ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
