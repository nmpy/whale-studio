"use client";

// src/app/oas/[id]/settings/members/_MemberInviteUrlSection.tsx
// メールアドレス不要の「招待URL」発行 UI（メンバー管理 > 招待タブの主導線）。
// - ロールを選んで発行 → URL を表示・コピー（発行直後のみ表示。再表示不可＝再発行）
// - 未使用の招待URL一覧（状態・ロール・期限・無効化）

import { useCallback, useEffect, useState } from "react";
import { memberInviteApi, type MemberInviteRow } from "@/lib/api-client";

type InviteRole = "admin" | "editor" | "tester" | "viewer";
const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "viewer", label: "閲覧者" },
  { value: "tester", label: "テスター" },
  { value: "editor", label: "編集者" },
  { value: "admin",  label: "管理者" },
];
const ROLE_LABEL: Record<string, string> = { admin: "管理者", editor: "編集者", tester: "テスター", viewer: "閲覧者" };
const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending:  { label: "未使用",     bg: "#dbeafe", color: "#1d4ed8" },
  accepted: { label: "使用済み",   bg: "#dcfce7", color: "#16a34a" },
  expired:  { label: "期限切れ",   bg: "#f3f4f6", color: "#6b7280" },
  revoked:  { label: "無効化済み", bg: "#f3f4f6", color: "#6b7280" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "無期限";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

interface Props {
  oaId:  string;
  token: string;
  showToast: (msg: string, type?: "success" | "error") => void;
}

export function MemberInviteUrlSection({ oaId, token, showToast }: Props) {
  const [role, setRole]         = useState<InviteRole>("viewer");
  const [issuing, setIssuing]   = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [list, setList]         = useState<MemberInviteRow[]>([]);
  const [loading, setLoading]   = useState(true);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      setList(await memberInviteApi.list(token, oaId));
    } catch {
      // 一覧取得失敗時は空表示（発行自体は可能）
    } finally {
      setLoading(false);
    }
  }, [token, oaId]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  async function handleIssue() {
    setIssuing(true);
    setIssuedUrl(null);
    try {
      const res = await memberInviteApi.create(token, oaId, { role });
      setIssuedUrl(res.invite_url);
      await fetchList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "招待URLの発行に失敗しました", "error");
    } finally {
      setIssuing(false);
    }
  }

  async function handleCopy() {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      showToast("招待URLをコピーしました", "success");
    } catch {
      showToast("コピーに失敗しました。手動で選択してコピーしてください", "error");
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("この招待URLを無効化しますか？\n無効化すると、このURLでは参加できなくなります。")) return;
    try {
      await memberInviteApi.revoke(token, oaId, id);
      showToast("招待URLを無効化しました", "success");
      await fetchList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "無効化に失敗しました", "error");
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 4 }}>招待URLを発行（メール不要）</h3>
      <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7, marginBottom: 14 }}>
        メールアドレスを指定せずに、招待URLを発行できます。招待されたメンバーは、初回登録時にメールアドレスを入力します。
        <br />
        URLを知っている人が参加できるため、必要な相手にのみ共有してください。不要になった招待URLは無効化できます。
      </p>

      {/* 発行フォーム */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "#374151" }}>権限ロール</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as InviteRole)}
          style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, background: "#fff" }}
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          type="button"
          onClick={handleIssue}
          disabled={issuing}
          style={{ padding: "8px 18px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: issuing ? "not-allowed" : "pointer", opacity: issuing ? 0.6 : 1 }}
        >
          {issuing ? "発行中…" : "招待URLを発行"}
        </button>
      </div>

      {/* 発行直後の URL 表示（再表示不可） */}
      {issuedUrl && (
        <div style={{ marginTop: 14, padding: "12px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>招待URLを発行しました</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              readOnly
              value={issuedUrl}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: "1 1 260px", minWidth: 200, padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 12, fontFamily: "ui-monospace, monospace", background: "#fff" }}
            />
            <button type="button" onClick={handleCopy} style={{ padding: "7px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>コピー</button>
          </div>
          <p style={{ fontSize: 11, color: "#15803d", marginTop: 8, lineHeight: 1.6 }}>
            このURLを相手に送ってください。相手は登録時にメールアドレスを入力します。
            <br />
            ※ このURLは発行時のみ表示されます。必要な場合は再発行してください。
          </p>
        </div>
      )}

      {/* 招待URL一覧 */}
      <div style={{ marginTop: 18 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>発行済みの招待URL</p>
        {loading ? (
          <p style={{ fontSize: 12, color: "#9ca3af" }}>読み込み中…</p>
        ) : list.length === 0 ? (
          <p style={{ fontSize: 12, color: "#9ca3af" }}>発行済みの招待URLはありません。</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {list.map((inv) => {
              const meta = STATUS_META[inv.status] ?? STATUS_META.pending;
              return (
                <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid #eef2f5", borderRadius: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color, borderRadius: 10, padding: "2px 8px" }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: "#374151" }}>{ROLE_LABEL[inv.role] ?? inv.role}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>作成 {fmtDate(inv.created_at)}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>期限 {fmtDate(inv.expires_at)}</span>
                  {inv.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(inv.id)}
                      style={{ marginLeft: "auto", padding: "4px 12px", background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      無効化
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, lineHeight: 1.6 }}>
          招待URLは発行時のみ表示されます。再コピーが必要な場合は新しい招待URLを発行してください。
        </p>
      </div>
    </div>
  );
}
