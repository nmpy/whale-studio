"use client";

// src/app/admin/uzu-pro-grants/_client.tsx
// ウズプロ権限（UzuProGrant）一覧 + 付与 + 解除（platform owner 専用）。
// GET/POST/DELETE /api/admin/uzu-pro-grants を叩く。
// 扱うのは Supabase の userId のみ（PII ではない）。氏名/メール/プレイヤー情報は取得も表示もしない。

import { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { useToast } from "@/components/Toast";

interface GrantRow {
  userId: string;
  grantedBy: string;
  createdAt: string;
}

/** ISO → JST "YYYY/MM/DD HH:mm"。null/不正は「未取得」。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未取得";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "未取得";
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12, verticalAlign: "top", borderBottom: "1px solid var(--border-light)" };
const th: React.CSSProperties = { padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textAlign: "left", borderBottom: "2px solid var(--border-light)", whiteSpace: "nowrap" };
const muted: React.CSSProperties = { color: "var(--text-muted)" };
const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: 11 };

export function UzuProGrantsClient({ currentUserId }: { currentUserId: string }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<GrantRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/uzu-pro-grants", { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error?.message ?? "読み込みに失敗しました"); setRows([]); return; }
      const grants = j?.data?.grants;
      setRows(Array.isArray(grants) ? grants : []);
    } catch {
      setError("通信エラーが発生しました"); setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grant = useCallback(async (userId: string) => {
    const id = userId.trim();
    if (!id || granting) return;
    setGranting(true);
    try {
      const res = await fetch("/api/admin/uzu-pro-grants", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j?.error?.message ?? "付与に失敗しました", "error"); return; }
      showToast("ウズプロ権限を付与しました", "success");
      setInput("");
      await load();
    } catch {
      showToast("通信エラーが発生しました", "error");
    } finally {
      setGranting(false);
    }
  }, [granting, load, showToast]);

  const revoke = useCallback(async (userId: string) => {
    if (revokingId) return;
    setRevokingId(userId);
    try {
      const res = await fetch(`/api/admin/uzu-pro-grants?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(j?.error?.message ?? "解除に失敗しました", "error"); return; }
      showToast("ウズプロ権限を解除しました", "success");
      await load();
    } catch {
      showToast("通信エラーが発生しました", "error");
    } finally {
      setRevokingId(null);
    }
  }, [revokingId, load, showToast]);

  const selfGranted = (rows ?? []).some((r) => r.userId === currentUserId);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "var(--text-primary)" }}>ウズプロ権限</h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
        ウズプロ（上位機能）を利用できるユーザーを Supabase の userId 単位で付与・解除します。氏名やメールなどの個人情報は扱いません。
      </p>

      {/* 付与フォーム */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void grant(input); }}
          placeholder="Supabase の userId を入力"
          spellCheck={false}
          style={{ flex: "1 1 320px", minWidth: 240, padding: "8px 12px", border: "1px solid var(--border-light)", borderRadius: 8, fontSize: 13, fontFamily: "monospace" }}
        />
        <button
          type="button"
          onClick={() => void grant(input)}
          disabled={granting || !input.trim()}
          style={{ padding: "8px 16px", border: "none", borderRadius: 8, background: input.trim() ? "var(--color-brand,#22c55e)" : "#cbd5e1", color: "#fff", fontSize: 13, fontWeight: 700, cursor: granting || !input.trim() ? "not-allowed" : "pointer", opacity: granting ? 0.7 : 1 }}
        >
          {granting ? "付与中…" : "付与"}
        </button>
        <button
          type="button"
          onClick={() => void grant(currentUserId)}
          disabled={granting || selfGranted}
          title={selfGranted ? "すでに自分に付与済みです" : "自分の userId に付与します"}
          style={{ padding: "8px 16px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 13, fontWeight: 600, cursor: granting || selfGranted ? "not-allowed" : "pointer", opacity: selfGranted ? 0.5 : 1 }}
        >
          自分に付与
        </button>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#991b1b", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        {loading ? "読み込み中…" : `${rows?.length ?? 0} 件`}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border-light)", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead>
            <tr>
              <th style={th}>userId</th>
              <th style={th}>付与者（grantedBy）</th>
              <th style={th}>付与日時</th>
              <th style={{ ...th, textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && !loading && (
              <tr><td style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: "28px" }} colSpan={4}>付与されたユーザーはいません。</td></tr>
            )}
            {(rows ?? []).map((r) => (
              <tr key={r.userId}>
                <td style={{ ...td, ...mono }} title={r.userId}>
                  {r.userId}
                  {r.userId === currentUserId && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)", fontFamily: "inherit" }}>（自分）</span>
                  )}
                </td>
                <td style={{ ...td, ...mono, ...muted }} title={r.grantedBy}>{r.grantedBy || "—"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtJst(r.createdAt)}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => void revoke(r.userId)}
                    disabled={revokingId === r.userId}
                    style={{ padding: "5px 12px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 12, fontWeight: 600, color: "#b91c1c", cursor: revokingId === r.userId ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: revokingId === r.userId ? 0.6 : 1 }}
                  >
                    {revokingId === r.userId ? "解除中…" : "解除"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
