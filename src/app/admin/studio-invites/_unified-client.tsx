"use client";

// src/app/admin/studio-invites/_unified-client.tsx
// 統合「招待URL発行」UI（個人/法人を1画面に統合）。feature flag ON 時に表示。
//
// 重要な制約:
//   - 平文 token は発行直後の 1 回のみ表示（DB は tokenHash のみ）。一覧から URL コピーは不可。
//     一覧では「再発行」（同設定で新URLを発行）で対応する。
//   - 内部は Organization を使わず oaId で扱う（個人=personal OA / 法人=business OA）。
//   - inviteAction は記録メタdata。受諾挙動の出し分け（新規登録/OA作成等）は本PRでは未実装＝従来どおり対象OAへ反映。

import { useEffect, useMemo, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { PLAN_TIER_ORDER, PLAN_LABELS } from "@/lib/constants/plans";
import { ROLE_LABELS } from "@/lib/types/permissions";
import {
  type InviteScope, type StudioInviteAction,
  STUDIO_INVITE_ROLES, STUDIO_INVITE_EXPIRES_OPTIONS, STUDIO_INVITE_MAX_USES_LIMIT,
  UNIFIED_INVITE_OPTIONS, INVITE_ACTION_LABELS, scopeUsageType,
} from "@/lib/studio-invite-ui";

type OaOption = { id: string; title: string; usage_type: string };
type InviteRow = {
  id: string;
  oa_id: string; oa_name: string;
  usage_type: string; usage_type_label: string;
  plan_tier: string; plan_label: string;
  role: string; role_label: string;
  note: string | null;
  invite_action: string | null;
  email: string | null;
  max_uses: number; used_count: number;
  state: "active" | "accepted" | "used_up" | "expired" | "revoked" | "none";
  created_by: string;
  created_at: string; expires_at: string;
};
type Issued = { invite_url: string; oa_name: string; usage_type_label: string; plan_label: string; role_label: string; expires_at: string };

const STATE_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: "有効",     bg: "#dcfce7", color: "#166534" },
  accepted: { label: "使用済み", bg: "#f3f4f6", color: "#6b7280" },
  used_up:  { label: "上限到達", bg: "#e0e7ff", color: "#3730a3" },
  expired:  { label: "期限切れ", bg: "#fef3c7", color: "#92400e" },
  revoked:  { label: "無効",     bg: "#fee2e2", color: "#b91c1c" },
  none:     { label: "無効",     bg: "#fee2e2", color: "#b91c1c" },
};
const SCOPE_LABEL: Record<InviteScope, string> = { personal: "個人", business: "法人" };

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function actionLabel(a: string | null): string {
  if (!a) return "—";
  return INVITE_ACTION_LABELS[a as StudioInviteAction] ?? a;
}

export function UnifiedStudioInvitesClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [oas, setOas]         = useState<OaOption[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);

  // フォーム状態
  const [scope, setScope]       = useState<InviteScope>("personal");
  const [optionKey, setOptionKey] = useState<string>(UNIFIED_INVITE_OPTIONS.personal[0].key);
  const [oaId, setOaId]         = useState("");
  const [planTier, setPlan]     = useState<string>("basic");
  const [role, setRole]         = useState<string>("viewer");
  const [email, setEmail]       = useState("");
  const [expiresDays, setDays]  = useState<number>(7);
  const [maxUses, setMaxUses]   = useState<number>(1);
  const [note, setNote]         = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId]         = useState<string | null>(null);
  const [issued, setIssued]         = useState<Issued | null>(null);
  const [copied, setCopied]         = useState(false);

  // scope に応じた OA 候補 / 招待内容候補（このUIは「既存OAへの招待」のみ）
  const scopeOas      = useMemo(() => oas.filter((o) => o.usage_type === scopeUsageType(scope)), [oas, scope]);
  const scopeOptions  = UNIFIED_INVITE_OPTIONS[scope];
  const selectedOption = scopeOptions.find((o) => o.key === optionKey) ?? scopeOptions[0];

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/studio-invites", { headers: { ...getAuthHeaders() }, cache: "no-store" });
      if (!res.ok) throw new Error("一覧の取得に失敗しました");
      const json = await res.json();
      const data = json.data ?? json;
      setOas(data.oas ?? []);
      setInvites(data.invites ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // scope 変更時に招待内容・権限・対象OAを既定に合わせる
  useEffect(() => {
    const first = UNIFIED_INVITE_OPTIONS[scope][0];
    setOptionKey(first.key);
    setRole(first.defaultRole);
  }, [scope]);
  useEffect(() => {
    if (scopeOas.length > 0 && !scopeOas.some((o) => o.id === oaId)) setOaId(scopeOas[0].id);
    if (scopeOas.length === 0) setOaId("");
  }, [scopeOas, oaId]);

  async function issue() {
    if (!oaId || submitting) return;
    setSubmitting(true); setError(null); setIssued(null); setCopied(false);
    try {
      const body = {
        oa_id: oaId, usage_type: scopeUsageType(scope), plan_tier: planTier,
        role, invite_action: selectedOption.inviteAction,
        email: email.trim() || undefined,
        max_uses: maxUses, expires_in_days: expiresDays,
        note: note.trim() || undefined,
      };
      const res = await fetch("/api/admin/studio-invites", {
        method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "招待URLの発行に失敗しました");
      const d = json.data ?? json;
      setIssued({ invite_url: d.invite_url, oa_name: d.oa_name, usage_type_label: d.usage_type_label, plan_label: d.plan_label, role_label: d.role_label, expires_at: d.expires_at });
      setNote(""); setEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  // 再発行（同設定で新URLを発行）。発行済みは tokenHash のみで平文再現不可のため、コピーの代替。
  async function reissue(row: InviteRow) {
    if (busyId) return;
    setBusyId(row.id); setError(null); setIssued(null); setCopied(false);
    try {
      const body = {
        oa_id: row.oa_id, usage_type: row.usage_type, plan_tier: row.plan_tier, role: row.role,
        invite_action: row.invite_action ?? undefined, email: row.email ?? undefined,
        max_uses: row.max_uses, note: row.note ?? undefined,
      };
      const res = await fetch("/api/admin/studio-invites", {
        method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "再発行に失敗しました");
      const d = json.data ?? json;
      setIssued({ invite_url: d.invite_url, oa_name: d.oa_name, usage_type_label: d.usage_type_label, plan_label: d.plan_label, role_label: d.role_label, expires_at: d.expires_at });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "再発行に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  async function setRevoked(row: InviteRow, action: "revoke" | "enable") {
    if (busyId) return;
    setBusyId(row.id); setError(null);
    try {
      const res = await fetch(`/api/admin/studio-invites/${row.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "操作に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  }

  const labelStyle  = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 } as const;
  const selectStyle = { width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" } as const;
  const th = { padding: "8px 10px", textAlign: "left" as const, fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" as const };

  return (
    <>
      <div className="page-header">
        <div>
          <h2>招待URL発行</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.7 }}>
            個人 / 法人の招待URLをここから発行できます。<strong>この招待URLは既存のOAへの招待（権限付与）です。新規OAの作成や新規ユーザー登録は行いません。</strong>
            対象OAの選択が必須です。招待URLは発行直後のみ表示・コピーできます（再表示不可。あとから渡すときは「再発行」してください）。
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", marginBottom: 16, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", borderRadius: 8, fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <InlineWhaleLoader padding={48} />
      ) : (
        <>
          {/* ── 発行フォーム ── */}
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <div>
                <label style={labelStyle}>種別</label>
                <select style={selectStyle} value={scope} onChange={(e) => setScope(e.target.value as InviteScope)}>
                  <option value="personal">個人</option>
                  <option value="business">法人</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>招待内容</label>
                <select style={selectStyle} value={optionKey} onChange={(e) => {
                  const opt = scopeOptions.find((o) => o.key === e.target.value);
                  if (opt) { setOptionKey(opt.key); setRole(opt.defaultRole); }
                }}>
                  {scopeOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>対象アカウント（OA）{<span style={{ color: "#dc2626" }}> *</span>}</label>
                <select style={selectStyle} value={oaId} onChange={(e) => setOaId(e.target.value)} disabled={scopeOas.length === 0}>
                  {scopeOas.length === 0
                    ? <option value="">{SCOPE_LABEL[scope]}のOAがありません</option>
                    : scopeOas.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>権限<span style={{ color: "#dc2626" }}> *</span></label>
                <select style={selectStyle} value={role} onChange={(e) => setRole(e.target.value)}>
                  {STUDIO_INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>プラン</label>
                <select style={selectStyle} value={planTier} onChange={(e) => setPlan(e.target.value)}>
                  {PLAN_TIER_ORDER.map((t) => <option key={t} value={t}>{PLAN_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>招待メールアドレス（任意）</label>
                <input type="email" style={selectStyle} value={email} maxLength={255} onChange={(e) => setEmail(e.target.value)} placeholder="例: user@example.com" />
              </div>
              <div>
                <label style={labelStyle}>招待期限</label>
                <select style={selectStyle} value={expiresDays} onChange={(e) => setDays(Number(e.target.value))}>
                  {STUDIO_INVITE_EXPIRES_OPTIONS.map((d) => <option key={d} value={d}>{d}日</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>最大使用回数</label>
                <input type="number" style={selectStyle} value={maxUses} min={1} max={STUDIO_INVITE_MAX_USES_LIMIT}
                  onChange={(e) => setMaxUses(Math.min(Math.max(1, Number(e.target.value) || 1), STUDIO_INVITE_MAX_USES_LIMIT))} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>メモ（任意・最大200文字）</label>
                <input type="text" style={selectStyle} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="例: ○○社の担当者向け" />
              </div>
            </div>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button type="button" className="btn btn-primary" onClick={issue} disabled={submitting || !oaId}>
                {submitting ? "発行中…" : "招待URLを発行"}
              </button>
            </div>
          </div>

          {/* ── 発行直後の招待URL（1回のみ表示・コピー可） ── */}
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
                {issued.oa_name} ／ 区分: {issued.usage_type_label} ／ プラン: {issued.plan_label} ／ 権限: {issued.role_label}
              </p>
              <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>有効期限：{fmt(issued.expires_at)}</p>
            </div>
          )}

          {/* ── 発行済み一覧 ── */}
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>発行済み招待URL</h3>
          {invites.length === 0 ? (
            <div className="card" style={{ padding: 20, color: "#6b7280", fontSize: 13 }}>まだ発行された招待URLはありません。</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={th}>種別</th><th style={th}>招待内容</th><th style={th}>対象アカウント</th>
                    <th style={th}>メール</th><th style={th}>権限</th><th style={th}>使用</th>
                    <th style={th}>期限</th><th style={th}>作成者</th><th style={th}>作成日時</th>
                    <th style={th}>状態</th><th style={th}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const badge = STATE_BADGE[inv.state] ?? STATE_BADGE.none;
                    const busy = busyId === inv.id;
                    return (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px" }}>{inv.usage_type_label}</td>
                        <td style={{ padding: "10px" }}>{actionLabel(inv.invite_action)}</td>
                        <td style={{ padding: "10px", fontWeight: 600 }}>{inv.oa_name}{inv.note ? <span style={{ display: "block", fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>{inv.note}</span> : null}</td>
                        <td style={{ padding: "10px", color: "#6b7280" }}>{inv.email ?? "—"}</td>
                        <td style={{ padding: "10px" }}>{inv.role_label}</td>
                        <td style={{ padding: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>{inv.used_count} / {inv.max_uses}</td>
                        <td style={{ padding: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(inv.expires_at)}</td>
                        <td style={{ padding: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>{inv.created_by}</td>
                        <td style={{ padding: "10px", color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(inv.created_at)}</td>
                        <td style={{ padding: "10px" }}>
                          <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: badge.bg, color: badge.color }}>{badge.label}</span>
                        </td>
                        <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                          <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", marginRight: 4 }} disabled={busy} onClick={() => reissue(inv)}>再発行</button>
                          {inv.state === "revoked"
                            ? <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} disabled={busy} onClick={() => setRevoked(inv, "enable")}>再有効化</button>
                            : <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px", color: "#b91c1c" }} disabled={busy} onClick={() => setRevoked(inv, "revoke")}>無効化</button>}
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

export default UnifiedStudioInvitesClient;
