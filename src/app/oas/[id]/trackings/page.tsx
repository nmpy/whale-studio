"use client";

// src/app/oas/[id]/trackings/page.tsx
// トラッキングリンク管理画面

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { trackingApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import type { Tracking } from "@/types";

// ────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────

function buildTrackingUrl(trackingId: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_BASE_URL ?? "";
  return `${base}/t/${trackingId}`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        padding: "2px 10px", fontSize: 11, borderRadius: 6,
        border: "1px solid #d1d5db", background: copied ? "#dcfce7" : "#fff",
        color: copied ? "#16a34a" : "#374151", cursor: "pointer", flexShrink: 0,
        transition: "all 0.15s",
      }}
    >
      {copied ? "✓ コピー済" : "コピー"}
    </button>
  );
}

// ────────────────────────────────────────────────
// 追加フォーム
// ────────────────────────────────────────────────

const EMPTY_FORM = { name: "", target_url: "", utm_enabled: true };

function AddForm({
  oaId,
  onSaved,
}: {
  oaId:    string;
  onSaved: (t: Tracking) => void;
}) {
  const [form, setForm]       = useState(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);
  const { showToast }         = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.target_url.trim()) return;
    setSaving(true);
    try {
      const t = await trackingApi.create(getDevToken(), {
        oa_id:       oaId,
        name:        form.name.trim(),
        target_url:  form.target_url.trim(),
        utm_enabled: form.utm_enabled,
      });
      onSaved(t);
      setForm(EMPTY_FORM);
      showToast("トラッキングリンクを追加しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "追加に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 10, alignItems: "end" }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: 12 }}>リンク名 <span style={{ color: "#dc2626" }}>*</span></label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="例: X投稿_4月謎解き"
            required
          />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: 12 }}>遷移先URL <span style={{ color: "#dc2626" }}>*</span></label>
          <input
            value={form.target_url}
            onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))}
            placeholder="https://lin.ee/xxxxxxx"
            required
          />
        </div>
        <div style={{ paddingBottom: 2 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={form.utm_enabled}
              onChange={(e) => setForm((f) => ({ ...f, utm_enabled: e.target.checked }))}
            />
            UTM付与
          </label>
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || !form.name.trim() || !form.target_url.trim()}
          style={{ whiteSpace: "nowrap" }}
        >
          {saving && <span className="spinner" />}
          {saving ? "追加中..." : "＋ 追加"}
        </button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────
// 統計バッジ
// ────────────────────="────────────────────────────

function StatBadge({
  icon, value, label, color,
}: {
  icon: string; value: number; label: string; color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64 }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1.2 }}>
        {value.toLocaleString()}
      </span>
      <span style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────
// トラッキングカード
// ────────────────────────────────────────────────

function TrackingCard({
  tracking,
  onDelete,
}: {
  tracking: Tracking;
  onDelete: (id: string) => void;
}) {
  const { showToast }         = useToast();
  const [deleting, setDeleting] = useState(false);
  const url = buildTrackingUrl(tracking.tracking_id);

  async function handleDelete() {
    if (!confirm(`「${tracking.name}」を削除しますか？\nクリックデータもすべて削除されます。`)) return;
    setDeleting(true);
    try {
      await trackingApi.delete(getDevToken(), tracking.id);
      onDelete(tracking.id);
      showToast("削除しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
      setDeleting(false);
    }
  }

  return (
    <div className="card" style={{ padding: "20px 24px", display: "flex", gap: 24, alignItems: "flex-start" }}>
      {/* 統計 */}
      <div style={{
        display: "flex", gap: 20, padding: "12px 20px",
        background: "#f9fafb", borderRadius: 10, flexShrink: 0,
        border: "1px solid #e5e7eb",
      }}>
        <StatBadge icon="👆" value={tracking.click_count} label="クリック" color="#2563eb" />
        <div style={{ width: 1, background: "#e5e7eb" }} />
        <StatBadge icon="👤" value={tracking.user_count}  label="流入ユーザー" color="#16a34a" />
      </div>

      {/* 情報 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: "#111827" }}>
            {tracking.name}
          </span>
          {tracking.utm_enabled && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "#2563eb",
              background: "#eff6ff", padding: "1px 6px", borderRadius: 10,
              border: "1px solid #bfdbfe",
            }}>
              UTM
            </span>
          )}
        </div>

        {/* トラッキングURL */}
        <div style={{ marginBottom: 6 }}>
          <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>トラッキングURL</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{
              fontSize: 12, color: "#2563eb", background: "#eff6ff",
              padding: "3px 8px", borderRadius: 6, flex: 1, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {url}
            </code>
            <CopyButton value={url} />
          </div>
        </div>

        {/* 遷移先URL */}
        <div>
          <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>遷移先URL</p>
          <span style={{
            fontSize: 12, color: "#6b7280",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "block",
          }}>
            {tracking.target_url}
          </span>
        </div>
      </div>

      {/* 削除 */}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleDelete}
        disabled={deleting}
        style={{ fontSize: 12, color: "#dc2626", flexShrink: 0 }}
      >
        {deleting ? "..." : "削除"}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────
// ページ
// ────────────────────────────────────────────────

export default function TrackingsPage() {
  const params            = useParams<{ id: string }>();
  const oaId              = params.id;
  const [trackings, setTrackings] = useState<Tracking[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await trackingApi.list(getDevToken(), oaId);
      setTrackings(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [oaId]);

  useEffect(() => { load(); }, [load]);

  const handleSaved  = (t: Tracking) => setTrackings((prev) => [...prev, t]);
  const handleDelete = (id: string)  => setTrackings((prev) => prev.filter((t) => t.id !== id));

  return (
    <>
      {/* ヘッダー */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "トラッキング" },
          ]} />
          <h2>トラッキング管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            /t/[ID] の中間URLでクリック数・流入ユーザーを計測します。
          </p>
        </div>
      </div>

      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "/t/[ID] 形式の中間 URL を発行してクリック数を計測します",
          "LINE 友達追加時に直近クリックとユーザーを自動で紐づけます",
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「+ トラッキングを追加」で名前とリダイレクト先 URL を設定します",
          "発行された /t/[ID] URL を X などの投稿に貼り付けます",
          "クリック数と流入ユーザー数がリアルタイムで更新されます",
        ]},
        { icon: "🔗", title: "仕組み", points: [
          "クリック → イベント記録 → LINE へリダイレクト",
          "友達追加 webhook で直近 30 分のクリックと紐づけ",
          "UTM パラメータを付与することで Google Analytics でも計測できます",
        ]},
      ]} />

      {/* 仕組み説明 */}
      <div className="card" style={{ marginBottom: 20, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
        <p style={{ fontSize: 13, color: "#1d4ed8", margin: 0, lineHeight: 1.7 }}>
          <strong>📊 仕組み</strong><br />
          X（旧Twitter）などに<code style={{ fontSize: 12 }}>/t/[ID]</code>のURLを投稿 →
          クリック時にイベントを記録してLINEへリダイレクト →
          友達追加時（follow webhook）に直近クリックと紐づけてユーザーを帰属。
        </p>
      </div>

      {/* 追加フォーム */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>新しいトラッキングリンクを追加</h3>
        <AddForm oaId={oaId} onSaved={handleSaved} />
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="card" style={{ padding: 0 }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 16 }}>
              <div className="skeleton" style={{ width: 120, height: 60, borderRadius: 10 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 200, height: 14, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: "70%", height: 12 }} />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="alert alert-error">{loadError}</div>
      ) : trackings.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔗</div>
            <p className="empty-state-title">トラッキングリンクがありません</p>
            <p className="empty-state-desc">上のフォームから最初のトラッキングリンクを追加してください。</p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {trackings.map((t) => (
            <TrackingCard key={t.id} tracking={t} onDelete={handleDelete} />
          ))}
          <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
            {trackings.length} 件
          </p>
        </div>
      )}
    </>
  );
}
