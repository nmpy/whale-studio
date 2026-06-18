"use client";

// src/app/admin/studio-invites/_client.tsx
// 招待URL発行 UI（対象 OA・利用区分・プラン権限・ロールを指定して招待URLを発行）。
//
// セキュリティ: 平文 token は発行直後の 1 回のみ表示（DB は tokenHash のみ保存のため再表示不可）。
//   そのため一覧には「招待URL」列を出さず、発行直後カードでのみ URL を表示する（member-invite と同方針）。

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { USAGE_TYPES, USAGE_TYPE_SHORT_LABELS } from "@/lib/usage-type";
import { PLAN_TIER_ORDER, PLAN_LABELS } from "@/lib/constants/plans";
import { ROLE_LABELS } from "@/lib/types/permissions";

// owner は URL 招待で配らない（発行 API 側でも除外）。
const INVITE_ROLES = ["admin", "editor", "tester", "viewer"] as const;

type OaOption = { id: string; title: string; usage_type: string };
type InviteRow = {
  id: string;
  oa_id: string;
  oa_name: string;
  usage_type: string;
  usage_type_label: string;
  plan_tier: string;
  plan_label: string;
  role: string;
  role_label: string;
  note: string | null;
  state: "active" | "accepted" | "expired" | "revoked" | "none";
  created_at: string;
  expires_at: string;
};
type Issued = {
  invite_url: string;
  oa_name: string;
  usage_type_label: string;
  plan_label: string;
  role_label: string;
  expires_at: string;
};

const STATE_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: "有効",     bg: "#dcfce7", color: "#166534" },
  accepted: { label: "使用済み", bg: "#f3f4f6", color: "#6b7280" },
  expired:  { label: "期限切れ", bg: "#fef3c7", color: "#92400e" },
  revoked:  { label: "無効",     bg: "#fee2e2", color: "#b91c1c" },
  none:     { label: "無効",     bg: "#fee2e2", color: "#b91c1c" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function StudioInvitesClient() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [oas, setOas]           = useState<OaOption[]>([]);
  const [invites, setInvites]   = useState<InviteRow[]>([]);

  const [oaId, setOaId]         = useState("");
  const [usageType, setUsage]   = useState<string>("business");
  const [planTier, setPlan]     = useState<string>("basic");
  const [role, setRole]         = useState<string>("viewer");
  const [note, setNote]         = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued]         = useState<Issued | null>(null);
  const [copied, setCopied]         = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/studio-invites", { headers: { ...getAuthHeaders() }, cache: "no-store" });
      if (!res.ok) throw new Error("一覧の取得に失敗しました");
      const json = await res.json();
      const data = json.data ?? json;
      setOas(data.oas ?? []);
      setInvites(data.invites ?? []);
      if ((data.oas ?? []).length > 0 && !oaId) setOaId(data.oas[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function issue() {
    if (!oaId || submitting) return;
    setSubmitting(true);
    setError(null);
    setIssued(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/studio-invites", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body:    JSON.stringify({ oa_id: oaId, usage_type: usageType, plan_tier: planTier, role, note: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "招待URLの発行に失敗しました");
      const d = json.data ?? json;
      setIssued({
        invite_url:       d.invite_url,
        oa_name:          d.oa_name,
        usage_type_label: d.usage_type_label,
        plan_label:       d.plan_label,
        role_label:       d.role_label,
        expires_at:       d.expires_at,
      });
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard 不可は無視 */ }
  }

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 } as const;
  const selectStyle = { width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" } as const;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>招待URL発行</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.7 }}>
            利用区分・プラン・権限を指定して、ユーザー招待用のURLを発行できます。招待URLの有効期限は発行から1週間です。
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", marginBottom: 16, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <InlineWhaleLoader padding={48} />
      ) : oas.length === 0 ? (
        <div className="card" style={{ padding: 24, color: "#6b7280", fontSize: 13 }}>
          招待URLを発行できる対象アカウント（あなたが owner / admin のOA）がありません。
        </div>
      ) : (
        <>
          {/* ── 発行フォーム ── */}
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <div>
                <label style={labelStyle}>対象アカウント（OA）</label>
                <select style={selectStyle} value={oaId} onChange={(e) => setOaId(e.target.value)}>
                  {oas.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>利用区分</label>
                <select style={selectStyle} value={usageType} onChange={(e) => setUsage(e.target.value)}>
                  {USAGE_TYPES.map((u) => <option key={u} value={u}>{USAGE_TYPE_SHORT_LABELS[u]}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>プラン</label>
                <select style={selectStyle} value={planTier} onChange={(e) => setPlan(e.target.value)}>
                  {PLAN_TIER_ORDER.map((t) => <option key={t} value={t}>{PLAN_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>権限</label>
                <select style={selectStyle} value={role} onChange={(e) => setRole(e.target.value)}>
                  {INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>メモ（任意・最大200文字）</label>
                <input
                  type="text"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例: ○○社の担当者向け"
                  style={{ ...selectStyle }}
                />
              </div>
            </div>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button type="button" className="btn btn-primary" onClick={issue} disabled={submitting || !oaId}>
                {submitting ? "発行中…" : "招待URLを発行"}
              </button>
            </div>
          </div>

          {/* ── 発行直後の招待URL（1回のみ表示） ── */}
          {issued && (
            <div className="card" style={{ padding: 20, marginBottom: 20, border: "1.5px solid #06C755", background: "#f0fdf4" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 8 }}>招待URLを発行しました（このURLは再表示できません）</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input readOnly value={issued.invite_url} style={{ flex: 1, minWidth: 240, padding: "8px 10px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", fontFamily: "monospace" }} />
                <button type="button" className="btn btn-ghost" onClick={() => copy(issued.invite_url)} style={{ whiteSpace: "nowrap" }}>
                  {copied ? "コピーしました" : "コピー"}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "#374151", marginTop: 10 }}>
                {issued.oa_name} ／ 利用区分: {issued.usage_type_label} ／ プラン: {issued.plan_label} ／ 権限: {issued.role_label}
              </p>
              <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>有効期限：{fmt(issued.expires_at)}</p>
            </div>
          )}

          {/* ── 発行済み一覧（新しい順） ── */}
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>発行済み招待URL</h3>
          {invites.length === 0 ? (
            <div className="card" style={{ padding: 20, color: "#6b7280", fontSize: 13 }}>まだ発行された招待URLはありません。</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>対象アカウント</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>利用区分</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>プラン</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>権限</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>発行日時</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>有効期限</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const badge = STATE_BADGE[inv.state] ?? STATE_BADGE.none;
                    return (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px", fontWeight: 600 }}>{inv.oa_name}{inv.note ? <span style={{ display: "block", fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>{inv.note}</span> : null}</td>
                        <td style={{ padding: "10px" }}>{inv.usage_type_label}</td>
                        <td style={{ padding: "10px" }}>{inv.plan_label}</td>
                        <td style={{ padding: "10px" }}>{inv.role_label}</td>
                        <td style={{ padding: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(inv.created_at)}</td>
                        <td style={{ padding: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(inv.expires_at)}</td>
                        <td style={{ padding: "10px" }}>
                          <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: badge.bg, color: badge.color }}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default StudioInvitesClient;
