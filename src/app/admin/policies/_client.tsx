"use client";

// src/app/admin/policies/_client.tsx
// 規約管理画面の Client 部分。
// タブ: 利用規約編集 / プライバシーポリシー編集 / 同意履歴 の 3 つ。
// 編集は「新しいバージョンを作成 (= 即時公開 or 下書き)」「既存下書きを公開」のパターン。

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";

interface PolicySnapshot {
  version:     string;
  title:       string;
  body:        string;
  lastUpdated: string | null;
  effectiveAt: string | null;
  publishedAt: string | null;
  fromDb:      boolean;
}

interface VersionRow {
  id:           string;
  type:         "TERMS" | "PRIVACY_POLICY";
  version:      string;
  title:        string;
  is_published: boolean;
  published_at: string | null;
  created_at:   string;
  updated_at:   string;
}

interface AcceptanceRow {
  kind:        "TERMS" | "PRIVACY_POLICY";
  id:          string;
  user_id:     string;
  username:    string | null;
  email:       string | null;
  version:     string;
  accepted_at: string;
  created_at:  string;
}

interface Props {
  initialTab:     "terms" | "privacy" | "acceptances";
  currentTerms:   PolicySnapshot;
  currentPrivacy: PolicySnapshot;
  versions:       VersionRow[];
}

type Tab = "terms" | "privacy" | "acceptances";

function formatJst(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function PoliciesClient({ initialTab, currentTerms, currentPrivacy, versions }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <>
      <div className="page-header">
        <div>
          <h2>規約管理</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            利用規約・プライバシーポリシーの編集と同意履歴を管理します。
          </p>
        </div>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", marginBottom: 20, gap: 0 }}>
        <TabBtn active={tab === "terms"}       label="利用規約"        onClick={() => setTab("terms")} />
        <TabBtn active={tab === "privacy"}     label="プライバシーポリシー" onClick={() => setTab("privacy")} />
        <TabBtn active={tab === "acceptances"} label="同意履歴"        onClick={() => setTab("acceptances")} />
      </div>

      {tab === "terms"       && <PolicyEditTab type="TERMS"          current={currentTerms}   versions={versions.filter((v) => v.type === "TERMS")} />}
      {tab === "privacy"     && <PolicyEditTab type="PRIVACY_POLICY" current={currentPrivacy} versions={versions.filter((v) => v.type === "PRIVACY_POLICY")} />}
      {tab === "acceptances" && <AcceptancesTab />}
    </>
  );
}

function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding:      "8px 18px",
        fontSize:     13,
        fontWeight:   600,
        color:        active ? "#06C755" : "#6b7280",
        background:   "none",
        border:       "none",
        borderBottom: active ? "2px solid #06C755" : "2px solid transparent",
        cursor:       "pointer",
        transition:   "color 0.15s, border-color 0.15s",
        whiteSpace:   "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/* ── 規約編集タブ ──────────────────────────────────────────────────────── */

function PolicyEditTab({
  type,
  current,
  versions,
}: {
  type: "TERMS" | "PRIVACY_POLICY";
  current: PolicySnapshot;
  versions: VersionRow[];
}) {
  const [version,     setVersion]     = useState("");
  const [title,       setTitle]       = useState(current.title);
  const [body,        setBody]        = useState(current.body);
  const [lastUpdated, setLastUpdated] = useState(current.lastUpdated ?? "");
  const [effectiveAt, setEffectiveAt] = useState(current.effectiveAt ?? "");
  const [submitting,  setSubmitting]  = useState(false);
  const [message,     setMessage]     = useState<{ ok: boolean; text: string } | null>(null);

  async function handleCreate(publish: boolean) {
    if (submitting) return;
    if (!version.trim()) { setMessage({ ok: false, text: "version を入力してください" }); return; }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/policies", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          type,
          version:     version.trim(),
          title,
          body,
          lastUpdated: lastUpdated.trim() || null,
          effectiveAt: effectiveAt.trim() || null,
          publish,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.message ?? `保存に失敗しました (HTTP ${res.status})`;
        throw new Error(msg);
      }
      setMessage({ ok: true, text: publish ? "公開しました。リロードして反映確認してください。" : "下書き保存しました。" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "保存に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublishExisting(id: string) {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/policies/${id}/publish`, {
        method:  "POST",
        headers: { ...getAuthHeaders() },
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.message ?? `公開に失敗しました (HTTP ${res.status})`;
        throw new Error(msg);
      }
      setMessage({ ok: true, text: "公開しました。リロードして反映確認してください。" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "公開に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* 現在公開中 */}
      <section className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
          現在公開中{current.fromDb ? "" : " (= constants fallback / DB 未登録)"}
        </h3>
        <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "4px 12px", fontSize: 12, margin: 0 }}>
          <dt style={{ color: "#6b7280" }}>バージョン</dt><dd style={{ margin: 0 }}><code>{current.version}</code></dd>
          <dt style={{ color: "#6b7280" }}>タイトル</dt>   <dd style={{ margin: 0 }}>{current.title}</dd>
          <dt style={{ color: "#6b7280" }}>最終更新日</dt> <dd style={{ margin: 0 }}>{current.lastUpdated ?? "—"}</dd>
          <dt style={{ color: "#6b7280" }}>施行日</dt>     <dd style={{ margin: 0 }}>{current.effectiveAt ?? "—"}</dd>
          <dt style={{ color: "#6b7280" }}>公開日時</dt>   <dd style={{ margin: 0 }}>{formatJst(current.publishedAt)}</dd>
        </dl>
      </section>

      {/* 新規バージョン作成フォーム */}
      <section className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
          新しいバージョンを作成
        </h3>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="version (例: 2026-06-15)">
            <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2026-06-15" style={inputStyle} />
          </Field>
          <Field label="title">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="最終更新日 (表示用 / 自由文字列)">
            <input type="text" value={lastUpdated} onChange={(e) => setLastUpdated(e.target.value)} placeholder="2026年6月15日" style={inputStyle} />
          </Field>
          <Field label="施行日 (表示用 / 自由文字列)">
            <input type="text" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} placeholder="2026年6月15日" style={inputStyle} />
          </Field>
          <Field label="本文">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              style={{ ...inputStyle, fontFamily: "monospace", lineHeight: 1.6, whiteSpace: "pre" }}
            />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" disabled={submitting} onClick={() => handleCreate(false)} className="btn btn-ghost" style={{ padding: "8px 16px" }}>
              下書き保存
            </button>
            <button type="button" disabled={submitting} onClick={() => handleCreate(true)} className="btn btn-primary" style={{ padding: "8px 20px" }}>
              {submitting ? "送信中…" : "公開する"}
            </button>
          </div>
          {message && (
            <div style={{
              padding: "10px 14px", borderRadius: 6, fontSize: 13,
              background: message.ok ? "#ecfdf5" : "#fef2f2",
              color:      message.ok ? "#166534" : "#dc2626",
              border:     `1px solid ${message.ok ? "#bbf7d0" : "#fecaca"}`,
            }}>{message.text}</div>
          )}
        </div>
      </section>

      {/* 既存バージョン一覧 */}
      <section className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
          既存バージョン (= 最新 {versions.length} 件)
        </h3>
        {versions.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>まだ DB にバージョンが登録されていません。</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={th}>version</th>
                <th style={th}>title</th>
                <th style={th}>公開状態</th>
                <th style={th}>公開日時 (JST)</th>
                <th style={th}>作成日時 (JST)</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={td}><code>{v.version}</code></td>
                  <td style={td}>{v.title}</td>
                  <td style={td}>
                    {v.is_published
                      ? <span style={{ color: "#166534", fontWeight: 700 }}>公開中</span>
                      : <span style={{ color: "#6b7280" }}>下書き</span>}
                  </td>
                  <td style={td}>{formatJst(v.published_at)}</td>
                  <td style={td}>{formatJst(v.created_at)}</td>
                  <td style={td}>
                    {!v.is_published && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handlePublishExisting(v.id)}
                        className="btn btn-primary"
                        style={{ padding: "3px 10px", fontSize: 11 }}
                      >
                        公開する
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ── 同意履歴タブ ──────────────────────────────────────────────────────── */

function AcceptancesTab() {
  const [rows,    setRows]    = useState<AcceptanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(true);

  useEffect(() => {
    fetch("/api/admin/policies/acceptances", { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error?.message ?? "取得に失敗しました");
        setRows(j.data ?? []);
        if (j.meta?.email_fetch_enabled === false) setEmailEnabled(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ fontSize: 13, color: "#6b7280" }}>読み込み中…</p>;
  if (error)   return <div style={{ padding: 14, background: "#fef2f2", color: "#dc2626", borderRadius: 6, fontSize: 13 }}>{error}</div>;

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p style={{ padding: 24, color: "#6b7280", fontSize: 14, margin: 0 }}>
            まだ同意履歴がありません。
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={th}>種別</th>
                  <th style={th}>ユーザー名</th>
                  <th style={th}>メールアドレス</th>
                  <th style={th}>user_id</th>
                  <th style={th}>同意バージョン</th>
                  <th style={th}>同意日時 (JST)</th>
                  <th style={th}>作成日時 (JST)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 10,
                        fontWeight: 700, background: r.kind === "TERMS" ? "#dbeafe" : "#fce7f3",
                        color:      r.kind === "TERMS" ? "#1e40af" : "#9d174d",
                      }}>
                        {r.kind === "TERMS" ? "利用規約" : "プライバシーポリシー"}
                      </span>
                    </td>
                    <td style={td}>{r.username ?? <span style={{ color: "#9ca3af" }}>(未登録)</span>}</td>
                    <td style={td}>
                      {r.email
                        ? r.email
                        : <span style={{ color: "#9ca3af" }}>{emailEnabled ? "(取得失敗)" : "(取得不可)"}</span>}
                    </td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>{r.user_id}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.version}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatJst(r.accepted_at)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "#6b7280" }}>{formatJst(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!emailEnabled && (
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>
          メールアドレスは Supabase Admin API 経由で取得します。表示されない場合は
          Vercel env に <code>SUPABASE_SERVICE_ROLE_KEY</code> が設定されているか確認してください。
        </p>
      )}
    </>
  );
}

/* ── 共通スタイル ──────────────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #d1d5db",
  borderRadius: 6, background: "#fff",
};

const th: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px", fontWeight: 700, color: "#374151",
  borderBottom: "1px solid #e5e7eb", fontSize: 12,
};
const td: React.CSSProperties = {
  padding: "8px 12px", color: "#374151",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
