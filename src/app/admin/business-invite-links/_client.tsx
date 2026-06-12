"use client";

// src/app/admin/business-invite-links/_client.tsx
// 法人招待リンク発行 UI (platform admin 専用ページの本体)。
// - 一覧表示（state / plan / role / note / 作成・申込日時）
// - 発行フォーム（plan / role / usageType / note / 有効期限）
// - 発行直後のみ 平文 token / URL を一度だけ表示（コピー可）。再表示不可。
// - active リンクの無効化（revoke）

import { useEffect, useState, useCallback } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { PLAN_TIER, PLAN_LABELS, PLAN_TIER_ORDER, type PlanTier } from "@/lib/constants/plans";
import { ROLE_LABELS } from "@/lib/types/permissions";

// ── 型 ──────────────────────────────────────────────────────────────
type LinkState = "active" | "used" | "expired" | "revoked" | "none";

interface InviteLink {
  id:               string;
  usage_type:       string;
  usage_type_label: string;
  plan_tier:        string;
  plan_label:       string;
  role:             string;
  role_label:       string;
  note:             string | null;
  state:            LinkState;
  expires_at:       string | null;
  used_at:          string | null;
  revoked_at:       string | null;
  created_at:       string;
  application: Application | null;
}

type AppStatus = "pending" | "approved" | "rejected";

interface Application {
  id:                          string;
  company_name:                string;
  contact_name:                string;
  contact_email:               string;
  line_official_account_name:  string | null;
  message:                     string | null;
  plan_tier:                   string;
  plan_label:                  string;
  role:                        string;
  role_label:                  string;
  usage_type:                  string;
  usage_type_label:            string;
  status:                      AppStatus;
  status_label:                string;
  reviewed_at:                 string | null;
  review_note:                 string | null;
  created_at:                  string;
}

interface IssuedLink extends InviteLink {
  token:      string;
  invite_url: string;
}

const APP_STATUS_META: Record<AppStatus, { label: string; color: string; bg: string }> = {
  pending:  { label: "未対応",   color: "#92400e", bg: "#fffbeb" },
  approved: { label: "承認済み", color: "#166534", bg: "#f0fdf4" },
  rejected: { label: "却下",     color: "#991b1b", bg: "#fef2f2" },
};

const ISSUE_ROLES = ["admin", "editor", "viewer"] as const;
type IssueRole = (typeof ISSUE_ROLES)[number];

// 発行で選べる plan は PLAN_TIER_ORDER 順 (basic→…→delegated)
const PLAN_OPTIONS = PLAN_TIER_ORDER.map((t) => ({ value: t as PlanTier, label: PLAN_LABELS[t] }));

type ExpiryMode = "default30" | "custom" | "unlimited";

const STATE_META: Record<LinkState, { label: string; color: string; bg: string }> = {
  active:  { label: "有効",   color: "#166534", bg: "#f0fdf4" },
  used:    { label: "申込済", color: "#1d4ed8", bg: "#eff6ff" },
  expired: { label: "期限切", color: "#92400e", bg: "#fffbeb" },
  revoked: { label: "無効化", color: "#991b1b", bg: "#fef2f2" },
  none:    { label: "—",      color: "#374151", bg: "#f3f4f6" },
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try { return new Date(dt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }); } catch { return dt; }
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16,
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 13, border: "1.5px solid #e5e7eb",
  borderRadius: 8, background: "#fff", color: "#111827",
};

export function BusinessInviteLinksClient() {
  const { showToast } = useToast();
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 発行フォーム state
  const [planTier, setPlanTier] = useState<PlanTier>(PLAN_TIER.pro);
  const [role, setRole] = useState<IssueRole>("editor");
  const [note, setNote] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("default30");
  const [customDays, setCustomDays] = useState<number>(30);

  // 発行直後の一度だけ表示する URL
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/business-invite-links", { headers: { ...getAuthHeaders() }, cache: "no-store" });
      if (!res.ok) {
        showToast("一覧の取得に失敗しました", "error");
        setLinks([]);
        return;
      }
      const json = await res.json();
      setLinks((json?.data ?? []) as InviteLink[]);
    } catch {
      showToast("一覧の取得に失敗しました", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  async function handleIssue() {
    if (submitting) return;
    setSubmitting(true);
    setIssued(null);
    try {
      const expiresInDays =
        expiryMode === "unlimited" ? null
        : expiryMode === "custom" ? Math.max(0, Math.floor(customDays))
        : 30;
      const res = await fetch("/api/admin/business-invite-links", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body:    JSON.stringify({ planTier, role, usageType: "business", note: note.trim() || undefined, expiresInDays }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error?.message ?? "発行に失敗しました", "error");
        return;
      }
      setIssued(json.data as IssuedLink);
      setNote("");
      showToast("招待リンクを発行しました", "success");
      void load();
    } catch {
      showToast("発行に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("このリンクを無効化しますか？（以降は申込できなくなります）")) return;
    try {
      const res = await fetch(`/api/admin/business-invite-links/${id}/revoke`, {
        method: "POST", headers: { ...getAuthHeaders() },
      });
      if (!res.ok) { showToast("無効化に失敗しました", "error"); return; }
      showToast("無効化しました", "success");
      void load();
    } catch {
      showToast("無効化に失敗しました", "error");
    }
  }

  async function handleReview(applicationId: string, status: "approved" | "rejected") {
    const verb = status === "approved" ? "承認" : "却下";
    const note = window.prompt(`${verb}メモ（任意）。OK で${verb}します。`, "");
    if (note === null) return; // キャンセル
    try {
      const res = await fetch(`/api/admin/business-invite-applications/${applicationId}/review`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body:    JSON.stringify({ status, reviewNote: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error?.message ?? `${verb}に失敗しました`, "error");
        return;
      }
      showToast(
        status === "approved"
          ? "承認しました。OA作成・権限付与・請求対応は手動で行ってください。"
          : "却下しました。",
        "success",
      );
      void load();
    } catch {
      showToast(`${verb}に失敗しました`, "error");
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => showToast("コピーしました", "success"))
      .catch(() => showToast("コピーに失敗しました", "error"));
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>法人招待リンク発行</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 1.7 }}>
        プラン / ロール / 利用区分を事前指定した法人申込 URL を発行します。URL には token のみが含まれ、
        プラン・ロールは DB で解決します（改ざん防止）。発行直後に表示される URL は一度しか表示されません。
      </p>

      {/* ── 発行フォーム ── */}
      <div style={{ ...card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>新規発行</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>付与予定プラン</label>
            <select style={inputStyle} value={planTier} onChange={(e) => setPlanTier(e.target.value as PlanTier)}>
              {PLAN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>付与予定ロール</label>
            <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as IssueRole)}>
              {ISSUE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}（{r}）</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>利用区分</label>
          <input style={{ ...inputStyle, background: "#f9fafb", color: "#6b7280" }} value="法人利用（business）" disabled readOnly />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>メモ（任意・運営用 / 宛先企業名など）</label>
          <input style={inputStyle} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="例: 株式会社〇〇 御中" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>有効期限</label>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}>
              <input type="radio" name="expiry" checked={expiryMode === "default30"} onChange={() => setExpiryMode("default30")} />
              30日（既定）
            </label>
            <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}>
              <input type="radio" name="expiry" checked={expiryMode === "custom"} onChange={() => setExpiryMode("custom")} />
              日数指定
            </label>
            {expiryMode === "custom" && (
              <input type="number" min={1} max={3650} value={customDays}
                onChange={(e) => setCustomDays(Number(e.target.value))}
                style={{ ...inputStyle, width: 100 }} />
            )}
            <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}>
              <input type="radio" name="expiry" checked={expiryMode === "unlimited"} onChange={() => setExpiryMode("unlimited")} />
              無期限
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={handleIssue}
          disabled={submitting}
          style={{
            padding: "9px 18px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none",
            background: submitting ? "#9ca3af" : "#06C755", color: "#fff", cursor: submitting ? "default" : "pointer",
          }}
        >
          {submitting ? "発行中..." : "招待リンクを発行"}
        </button>
      </div>

      {/* ── 発行直後の URL（一度だけ表示） ── */}
      {issued && (
        <div style={{ ...card, marginBottom: 20, border: "2px solid #06C755", background: "#f0fdf4" }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#166534" }}>
            発行しました（この URL はこの画面でしか表示されません）
          </h2>
          <div style={{ fontSize: 12, color: "#374151", marginBottom: 10 }}>
            {issued.usage_type_label} / {issued.plan_label} / {issued.role_label}
            {issued.expires_at ? ` / 期限 ${fmt(issued.expires_at)}` : " / 無期限"}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }} value={issued.invite_url} readOnly onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={() => copy(issued.invite_url)}
              style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1.5px solid #06C755", background: "#fff", color: "#166534", cursor: "pointer", whiteSpace: "nowrap" }}>
              コピー
            </button>
          </div>
        </div>
      )}

      {/* ── 一覧 ── */}
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>発行済みリンク</h2>
      {loading ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>読み込み中...</p>
      ) : links.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6b7280" }}>まだ発行されたリンクはありません。</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {links.map((l) => {
            const sm = STATE_META[l.state];
            return (
              <div key={l.id} style={{ ...card, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: sm.color, background: sm.bg }}>
                    {sm.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{l.plan_label}</span>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>/ {l.role_label} / {l.usage_type_label}</span>
                  {l.note && <span style={{ fontSize: 12, color: "#374151" }}>｜{l.note}</span>}
                  <span style={{ marginLeft: "auto" }} />
                  {l.state === "active" && (
                    <button type="button" onClick={() => handleRevoke(l.id)}
                      style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "1.5px solid #fca5a5", background: "#fff", color: "#991b1b", cursor: "pointer" }}>
                      無効化
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                  発行 {fmt(l.created_at)} ｜ 期限 {l.expires_at ? fmt(l.expires_at) : "無期限"} ｜ 申込 {fmt(l.used_at)}
                </div>

                {/* ── 申込内容（申込済みのみ） ── */}
                {l.application && (() => {
                  const app = l.application;
                  const asm = APP_STATUS_META[app.status] ?? APP_STATUS_META.pending;
                  return (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e5e7eb" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: asm.color, background: asm.bg }}>
                          {asm.label}
                        </span>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>申込内容</span>
                        <span style={{ marginLeft: "auto" }} />
                        {app.status === "pending" && (
                          <>
                            <button type="button" onClick={() => handleReview(app.id, "approved")}
                              style={{ fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 6, border: "none", background: "#06C755", color: "#fff", cursor: "pointer" }}>
                              承認
                            </button>
                            <button type="button" onClick={() => handleReview(app.id, "rejected")}
                              style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6, border: "1.5px solid #fca5a5", background: "#fff", color: "#991b1b", cursor: "pointer" }}>
                              却下
                            </button>
                          </>
                        )}
                      </div>

                      <dl style={{ display: "grid", gridTemplateColumns: "104px 1fr", gap: "3px 10px", fontSize: 12, color: "#374151", margin: 0 }}>
                        <dt style={{ color: "#9ca3af" }}>希望プラン</dt><dd style={{ margin: 0 }}>{app.plan_label} / {app.role_label} / {app.usage_type_label}</dd>
                        <dt style={{ color: "#9ca3af" }}>会社 / 団体</dt><dd style={{ margin: 0 }}>{app.company_name}</dd>
                        <dt style={{ color: "#9ca3af" }}>お名前</dt><dd style={{ margin: 0 }}>{app.contact_name}</dd>
                        <dt style={{ color: "#9ca3af" }}>メール</dt><dd style={{ margin: 0 }}>{app.contact_email}</dd>
                        <dt style={{ color: "#9ca3af" }}>LINE公式</dt><dd style={{ margin: 0 }}>{app.line_official_account_name || "—"}</dd>
                        <dt style={{ color: "#9ca3af" }}>相談 / 備考</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{app.message || "—"}</dd>
                        <dt style={{ color: "#9ca3af" }}>申込日時</dt><dd style={{ margin: 0 }}>{fmt(app.created_at)}</dd>
                      </dl>

                      {app.status !== "pending" && (
                        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb", fontSize: 11, color: "#6b7280" }}>
                          {asm.label}（{fmt(app.reviewed_at)}）
                          {app.review_note && <> ｜ メモ: {app.review_note}</>}
                          {app.status === "approved" && (
                            <div style={{ marginTop: 4, color: "#92400e" }}>
                              ※ 承認済みです。OA作成・権限付与・請求対応は手動で行ってください。
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
