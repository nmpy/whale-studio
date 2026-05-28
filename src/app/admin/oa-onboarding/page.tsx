"use client";

// src/app/admin/oa-onboarding/page.tsx
// OA 連携審査の運営側管理画面。
// /admin/layout.tsx で既にプラットフォームオーナー認可が掛かっているため、
// このページ自体に追加のガードは不要。

import { useEffect, useState } from "react";
import { getDevToken } from "@/lib/api-client";

interface AdminOaOnboarding {
  id:                 string;
  user_id:            string;
  username:           string | null;
  status:             "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  oa_id:              string | null;
  oa_name:            string | null;
  channel_id:         string | null;
  channel_secret_set: boolean;
  channel_token_set:  boolean;
  basic_id:           string | null;
  liff_id:            string | null;
  permission_url:     string | null;
  submitted_at:       string | null;
  reviewed_at:        string | null;
  reviewed_by:        string | null;
  review_note:        string | null;
  created_at:         string;
  updated_at:         string;
}

const STATUS_LABEL: Record<AdminOaOnboarding["status"], string> = {
  DRAFT:     "下書き",
  SUBMITTED: "提出済み",
  IN_REVIEW: "確認中",
  APPROVED:  "承認済み",
  REJECTED:  "差し戻し",
};

const STATUS_COLOR: Record<AdminOaOnboarding["status"], { bg: string; fg: string }> = {
  DRAFT:     { bg: "#f3f4f6", fg: "#374151" },
  SUBMITTED: { bg: "#dbeafe", fg: "#1e40af" },
  IN_REVIEW: { bg: "#dbeafe", fg: "#1e40af" },
  APPROVED:  { bg: "#dcfce7", fg: "#166534" },
  REJECTED:  { bg: "#fef3c7", fg: "#92400e" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP");
}

export default function AdminOaOnboardingPage() {
  const [rows,    setRows]    = useState<AdminOaOnboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [busyId,  setBusyId]  = useState<string | null>(null);

  // 差し戻しモーダル
  const [rejectTarget,    setRejectTarget]    = useState<AdminOaOnboarding | null>(null);
  const [rejectNote,      setRejectNote]      = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/oa-onboarding", {
        headers: { Authorization: `Bearer ${getDevToken()}` },
      });
      if (!res.ok) throw new Error("一覧の取得に失敗しました");
      const json = await res.json();
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function patchStatus(id: string, status: "APPROVED" | "REJECTED" | "IN_REVIEW", reviewNote?: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/oa-onboarding/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getDevToken()}`,
        },
        body: JSON.stringify({ status, review_note: reviewNote ?? null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message || "更新に失敗しました");
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  function openReject(row: AdminOaOnboarding) {
    setRejectTarget(row);
    setRejectNote(row.review_note ?? "");
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const note = rejectNote.trim();
    if (!note) {
      alert("差し戻し理由を入力してください");
      return;
    }
    await patchStatus(rejectTarget.id, "REJECTED", note);
    setRejectTarget(null);
    setRejectNote("");
  }

  if (loading) return <div style={{ padding: 24 }}>読み込み中…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>OA連携審査</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            ユーザーから提出された LINE 公式アカウント連携申請の承認 / 差し戻し
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", marginBottom: 16,
          border: "1px solid #fecaca", background: "#fef2f2",
          color: "#dc2626", borderRadius: 6, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ padding: 24, color: "#6b7280", fontSize: 13 }}>
          申請はまだありません。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>申請者</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>ステータス</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>OA名 / Channel ID</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>権限URL</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>提出日時</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>審査日時</th>
                <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const color = STATUS_COLOR[r.status];
                const canAct = r.status === "SUBMITTED" || r.status === "IN_REVIEW";
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 12px", verticalAlign: "top" }}>
                      <div style={{ fontWeight: 600 }}>{r.username ?? "(no name)"}</div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, wordBreak: "break-all" }}>
                        {r.user_id}
                      </div>
                    </td>
                    <td style={{ padding: "12px 12px", verticalAlign: "top" }}>
                      <span style={{
                        display: "inline-flex", padding: "2px 9px", borderRadius: 999,
                        background: color.bg, color: color.fg, fontSize: 11, fontWeight: 700,
                      }}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.review_note && (
                        <div style={{ fontSize: 11, color: "#92400e", marginTop: 4, maxWidth: 220 }}>
                          {r.review_note}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "12px 12px", verticalAlign: "top" }}>
                      <div>{r.oa_name ?? "—"}</div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{r.channel_id ?? "—"}</div>
                    </td>
                    <td style={{ padding: "12px 12px", verticalAlign: "top", maxWidth: 240 }}>
                      {r.permission_url ? (
                        <a
                          href={r.permission_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#2563eb", wordBreak: "break-all" }}
                        >
                          {r.permission_url}
                        </a>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "12px 12px", verticalAlign: "top", whiteSpace: "nowrap" }}>{fmtDate(r.submitted_at)}</td>
                    <td style={{ padding: "12px 12px", verticalAlign: "top", whiteSpace: "nowrap" }}>{fmtDate(r.reviewed_at)}</td>
                    <td style={{ padding: "12px 12px", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      {canAct ? (
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`「${r.oa_name ?? "(OA名なし)"}」を承認しますか？\nOa レコードと WorkspaceMember(owner) が作成されます。`)) {
                                patchStatus(r.id, "APPROVED");
                              }
                            }}
                            disabled={busyId !== null}
                            className="btn btn-primary"
                            style={{ padding: "4px 12px", fontSize: 12 }}
                          >
                            承認する
                          </button>
                          <button
                            type="button"
                            onClick={() => openReject(r)}
                            disabled={busyId !== null}
                            className="btn btn-ghost"
                            style={{ padding: "4px 12px", fontSize: 12 }}
                          >
                            差し戻す
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 差し戻しモーダル */}
      {rejectTarget && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 50, padding: 16,
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 10, maxWidth: 480, width: "100%",
            padding: "20px 22px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>差し戻し</h3>
            <p style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>
              「{rejectTarget.oa_name ?? "(OA名なし)"}」を差し戻します。理由を入力してください。
            </p>
            <textarea
              className="form-input"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="例: Channel Secret が誤っている可能性があります。再確認をお願いします。"
              rows={4}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button
                type="button"
                onClick={() => { setRejectTarget(null); setRejectNote(""); }}
                className="btn btn-ghost"
                style={{ padding: "8px 16px" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmReject}
                disabled={busyId !== null}
                className="btn btn-primary"
                style={{ padding: "8px 20px" }}
              >
                差し戻す
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
