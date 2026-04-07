"use client";

// src/app/admin/announcements/page.tsx
// お知らせ管理画面
// - 一覧表示（下書き + 公開済み）
// - 新規作成モーダル
// - 公開 / 非公開 トグル
// - 削除

import { useEffect, useState, useCallback } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { useToast } from "@/components/Toast";

// ── 型 ────────────────────────────────────────────────────────────────────
type AnnouncementType = "update" | "bugfix" | "known_issue" | "info";

interface Announcement {
  id:           string;
  type:         AnnouncementType;
  title:        string;
  body:         string;
  important:    boolean;
  published_at: string | null;
  sort_order:   number;
  created_by:   string;
  updated_by:   string | null;
  created_at:   string;
  updated_at:   string;
}

// ── 定数 ──────────────────────────────────────────────────────────────────
const TYPE_META: Record<AnnouncementType, { label: string; color: string; bg: string }> = {
  update:      { label: "アップデート", color: "#1d4ed8", bg: "#eff6ff" },
  bugfix:      { label: "不具合修正",   color: "#166534", bg: "#f0fdf4" },
  known_issue: { label: "既知の不具合", color: "#92400e", bg: "#fffbeb" },
  info:        { label: "お知らせ",     color: "#374151", bg: "#f3f4f6" },
};

const TYPE_OPTIONS: { value: AnnouncementType; label: string }[] = [
  { value: "info",        label: "お知らせ" },
  { value: "update",      label: "アップデート" },
  { value: "bugfix",      label: "不具合修正" },
  { value: "known_issue", label: "既知の不具合" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
}

// ── API ヘルパー ──────────────────────────────────────────────────────────
const authHeaders = () => ({
  "Content-Type": "application/json",
  ...getAuthHeaders(),
});

async function fetchAnnouncements(): Promise<Announcement[]> {
  const r = await fetch("/api/admin/announcements", { headers: authHeaders() });
  if (!r.ok) throw new Error("取得に失敗しました");
  const j = await r.json();
  return j.data;
}

async function createAnnouncement(body: {
  type: AnnouncementType; title: string; body: string;
  important: boolean; sortOrder: number; publish: boolean;
}): Promise<Announcement> {
  const r = await fetch("/api/admin/announcements", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error?.message ?? "作成に失敗しました");
  }
  return (await r.json()).data;
}

async function patchAnnouncement(id: string, body: Record<string, unknown>): Promise<Announcement> {
  const r = await fetch(`/api/admin/announcements/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error?.message ?? "更新に失敗しました");
  }
  return (await r.json()).data;
}

async function deleteAnnouncement(id: string): Promise<void> {
  const r = await fetch(`/api/admin/announcements/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error("削除に失敗しました");
}

// ── フォームモーダル ──────────────────────────────────────────────────────
function AnnouncementModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Partial<Announcement>;
  onClose: () => void;
  onSave:  (data: {
    type: AnnouncementType; title: string; body: string;
    important: boolean; sortOrder: number; publish: boolean;
  }) => Promise<void>;
}) {
  const [type,      setType]      = useState<AnnouncementType>(initial?.type ?? "info");
  const [title,     setTitle]     = useState(initial?.title ?? "");
  const [body,      setBody]      = useState(initial?.body ?? "");
  const [important, setImportant] = useState(initial?.important ?? false);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [publish,   setPublish]   = useState(initial?.published_at != null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("タイトルと本文は必須です");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ type, title: title.trim(), body: body.trim(), important, sortOrder, publish });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 540, maxWidth: "calc(100vw - 32px)",
        background: "#fff",
        borderRadius: 16,
        padding: "28px 32px",
        boxShadow: "0 20px 60px rgba(0,0,0,.18)",
        maxHeight: "90vh",
        overflowY: "auto",
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
          {initial?.id ? "お知らせを編集" : "お知らせを追加"}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* 種別 */}
          <div className="form-group">
            <label className="form-label">種別</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AnnouncementType)}
              className="form-input"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* タイトル */}
          <div className="form-group">
            <label className="form-label">タイトル <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: メッセージ送信の遅延を修正しました"
              maxLength={200}
              required
            />
          </div>

          {/* 本文 */}
          <div className="form-group">
            <label className="form-label">本文 <span style={{ color: "#ef4444" }}>*</span></label>
            <textarea
              className="form-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="ユーザーへ伝えたい内容を記載してください"
              maxLength={5000}
              style={{ resize: "vertical", minHeight: 100 }}
              required
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", marginTop: 2 }}>
              {body.length} / 5000
            </div>
          </div>

          {/* オプション行 */}
          <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
            {/* 重要フラグ */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span>🚨 重要フラグ</span>
            </label>

            {/* 表示順 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                表示順:
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                style={{
                  width: 64,
                  padding: "4px 8px",
                  border: "1px solid var(--border-light)",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* 公開設定 */}
          <div style={{
            padding: "12px 16px",
            background: publish ? "#f0fdf4" : "#f9fafb",
            border: `1px solid ${publish ? "#bbf7d0" : "#e5e7eb"}`,
            borderRadius: 8,
            marginBottom: 20,
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={publish}
                onChange={(e) => setPublish(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: publish ? "#166534" : "#374151" }}>
                  {publish ? "公開する" : "下書きとして保存"}
                </span>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {publish
                    ? "保存と同時にユーザーのお知らせ一覧に表示されます"
                    : "チェックを入れるまでユーザーには表示されません"}
                </div>
              </div>
            </label>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              キャンセル
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "保存中..." : initial?.id ? "更新する" : "作成する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────────────
export default function AdminAnnouncementsPage() {
  const [items,   setItems]   = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [modal,   setModal]   = useState<{ open: true; item?: Announcement } | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchAnnouncements());
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(data: {
    type: AnnouncementType; title: string; body: string;
    important: boolean; sortOrder: number; publish: boolean;
  }) {
    if (modal?.item?.id) {
      await patchAnnouncement(modal.item.id, data);
      showToast("お知らせを更新しました", "success");
    } else {
      await createAnnouncement(data);
      showToast("お知らせを作成しました", "success");
    }
    await load();
  }

  async function handleTogglePublish(item: Announcement) {
    const willPublish = item.published_at === null;
    try {
      await patchAnnouncement(item.id, { publish: willPublish });
      showToast(willPublish ? "公開しました" : "非公開にしました", "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新に失敗しました", "error");
    }
  }

  async function handleDelete(item: Announcement) {
    if (!confirm(`「${item.title}」を削除しますか？\nこの操作は取り消せません。`)) return;
    try {
      await deleteAnnouncement(item.id);
      showToast("削除しました", "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  const published = items.filter((a) => a.published_at !== null);
  const drafts    = items.filter((a) => a.published_at === null);

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <h2>お知らせ管理</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            ユーザー向けのお知らせを作成・公開できます
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModal({ open: true })}
        >
          ＋ お知らせを追加
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* ── 公開済み ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
            公開中
          </h3>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: "#166534", background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 10, padding: "1px 8px",
          }}>
            {published.length} 件
          </span>
        </div>

        {loading ? (
          <div className="card" style={{ padding: "24px 20px" }}>
            {[1,2].map((i) => (
              <div key={i} style={{ display: "flex", gap: 12, marginBottom: i < 2 ? 16 : 0 }}>
                <div className="skeleton" style={{ width: 60, height: 12 }} />
                <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 10 }} />
                <div className="skeleton" style={{ flex: 1, height: 13 }} />
              </div>
            ))}
          </div>
        ) : published.length === 0 ? (
          <div className="card">
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
              公開中のお知らせはありません
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {published.map((item, i) => (
              <AnnouncementRow
                key={item.id}
                item={item}
                isLast={i === published.length - 1}
                onEdit={() => setModal({ open: true, item })}
                onTogglePublish={() => handleTogglePublish(item)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 下書き ── */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
            下書き
          </h3>
          {drafts.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: "#6b7280", background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: 10, padding: "1px 8px",
            }}>
              {drafts.length} 件
            </span>
          )}
        </div>

        {!loading && drafts.length === 0 ? (
          <div className="card">
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
              下書きはありません
            </p>
          </div>
        ) : !loading && (
          <div className="card" style={{ padding: 0 }}>
            {drafts.map((item, i) => (
              <AnnouncementRow
                key={item.id}
                item={item}
                isLast={i === drafts.length - 1}
                onEdit={() => setModal({ open: true, item })}
                onTogglePublish={() => handleTogglePublish(item)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── モーダル ── */}
      {modal && (
        <AnnouncementModal
          initial={modal.item}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}

// ── 行コンポーネント ──────────────────────────────────────────────────────
function AnnouncementRow({
  item, isLast, onEdit, onTogglePublish, onDelete,
}: {
  item:            Announcement;
  isLast:          boolean;
  onEdit:          () => void;
  onTogglePublish: () => void;
  onDelete:        () => void;
}) {
  const meta      = TYPE_META[item.type];
  const published = item.published_at !== null;

  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          14,
      padding:      "13px 20px",
      borderBottom: isLast ? "none" : "1px solid var(--color-border-soft, #f0f0f0)",
      background:   item.important ? "#fffcf5" : "transparent",
    }}>
      {/* 日付 */}
      <span style={{
        fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap",
        flexShrink: 0, minWidth: 72,
        fontVariantNumeric: "tabular-nums",
      }}>
        {formatDate(item.published_at ?? item.created_at)}
      </span>

      {/* 種別バッジ */}
      <span style={{
        fontSize: 10, fontWeight: 700,
        color:    item.important ? "#92400e" : meta.color,
        background: item.important ? "#fef3c7" : meta.bg,
        padding: "2px 8px", borderRadius: 4,
        whiteSpace: "nowrap", flexShrink: 0, minWidth: 80, textAlign: "center",
      }}>
        {item.important ? "🚨 重要" : meta.label}
      </span>

      {/* タイトル */}
      <span style={{
        fontSize: 13, fontWeight: item.important ? 700 : 500,
        color: "var(--text-primary)",
        flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {item.title}
      </span>

      {/* 公開ステータス */}
      <span style={{
        fontSize: 11, fontWeight: 600,
        color:    published ? "#166534" : "#6b7280",
        background: published ? "#f0fdf4" : "#f3f4f6",
        border: `1px solid ${published ? "#bbf7d0" : "#e5e7eb"}`,
        borderRadius: 10, padding: "2px 8px",
        flexShrink: 0, whiteSpace: "nowrap",
      }}>
        {published ? "公開中" : "下書き"}
      </span>

      {/* アクション */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}
          onClick={onEdit}
        >
          編集
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{
            padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap",
            color: published ? "#9ca3af" : "var(--color-primary, #2F6F5E)",
          }}
          onClick={onTogglePublish}
        >
          {published ? "非公開" : "公開する"}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          style={{ padding: "4px 9px", fontSize: 11 }}
          onClick={onDelete}
        >
          削除
        </button>
      </div>
    </div>
  );
}
