"use client";

// src/app/oas/[id]/live/admin/EscapeIdImportSection.tsx
//   ESCAPE.ID 予約データ取込 UI（xlsx/xlsm/csv/tsv）。既存の参加者 CSV 取込とは独立したコンポーネント。
//   - 対象 Session は運営が明示選択（自動生成しない）。
//   - Preview は件数のみ（URL 生成なし）。Apply 時のみ token 発行 → LIFF URL を返す。
//   - LIFF URL は Apply レスポンス/この画面/生成 CSV のみで取得可能（DB 非保存）。

import { useMemo, useState } from "react";
import { buildTicketResultCsv, type TicketResultRow } from "@/lib/live-ticket-import";

type SessionOpt = { id: string; work_id: string | null; name: string; status: string; starts_at: string | null };

type PreviewResp = {
  mode: "preview";
  file: { name: string; format: string; total_rows: number };
  oa_liff_configured: boolean;
  session: { id: string; name: string; status: string; starts_at: string | null };
  counts: { total: number; valid: number; error: number; teams_create: number; teams_update: number; tokens_issue: number; tokens_skip: number };
  rows: Array<{ rowIndex: number; ticketId: string; groupType: string | null; teamName: string; plan: "issue" | "skip" | "error"; error: string; warnings: string[] }>;
};
type ApplyResp = { mode: "apply"; session: { id: string; name: string }; counts: { issued: number; skipped: number; failed: number }; rows: TicketResultRow[] };

const box: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 };
const btn: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontSize: 13 };
const btnPrimary: React.CSSProperties = { ...btn, background: "#06C755", color: "#fff", border: "1px solid #06C755" };

export function EscapeIdImportSection({
  oaId, workId, sessions, onError, onApplied,
}: {
  oaId: string;
  workId: string | null;
  sessions: SessionOpt[];
  onError: (msg: string) => void;
  onApplied?: () => void;
}) {
  const [sessionId, setSessionId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [applied, setApplied] = useState<ApplyResp | null>(null);
  const [busy, setBusy] = useState(false);

  // 対象 work のセッションのみ選択肢に（ended は除外）。
  const workSessions = useMemo(
    () => sessions.filter((s) => s.work_id === workId && s.status !== "ended"),
    [sessions, workId],
  );

  const submit = async (mode: "preview" | "apply", reissueIds?: string[]) => {
    if (!workId) { onError("先に対象 work を選択してください"); return; }
    if (!sessionId) { onError("対象 Session を選択してください"); return; }
    if (!file) { onError("ファイルを選択してください"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("work_id", workId);
      fd.append("session_id", sessionId);
      fd.append("mode", mode);
      if (reissueIds && reissueIds.length > 0) fd.append("reissue_ticket_ids", JSON.stringify(reissueIds));
      const res = await fetch(`/api/oas/${oaId}/live/ticket-import?mode=${mode}`, { method: "POST", credentials: "include", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) { onError(json?.error?.message ?? `取込に失敗しました (HTTP ${res.status})`); return; }
      if (mode === "preview") { setPreview(json.data as PreviewResp); setApplied(null); }
      else { setApplied(json.data as ApplyResp); onApplied?.(); }
    } catch {
      onError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    if (!applied) return;
    const csv = buildTicketResultCsv(applied.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `escapeid-liff-urls-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(href);
  };

  const copy = (url: string) => { void navigator.clipboard?.writeText(url); };

  return (
    <section style={{ ...box, marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>ESCAPE.ID 予約一覧の取込 → LIFF URL 生成</h3>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px" }}>
        Excel（.xlsx/.xlsm）/ CSV / TSV を取込み、1 行 = 1 チケット = 1 チーム を作成し、チケットごとの LIFF URL を発行します。
        参加者は作られません（LINE 連携時に作成）。CSV 内の公演日時は参考情報で、実際の紐付けは下で選んだ Session です。
      </p>

      {/* 対象 Session（明示選択・自動生成しない） */}
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>対象 Session（必須・自動生成しません）</label>
      {workSessions.length === 0 ? (
        <p style={{ fontSize: 13, color: "#b45309" }}>この work に選択可能な Session がありません。先に Session を作成してください。</p>
      ) : (
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ ...btn, cursor: "pointer", minWidth: 320 }} disabled={busy}>
          <option value="">— Session を選択 —</option>
          {workSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.status}{s.starts_at ? " / " + new Date(s.starts_at).toLocaleString("ja-JP") : ""}）
            </option>
          ))}
        </select>
      )}

      {/* ファイル */}
      <div style={{ marginTop: 12 }}>
        <input type="file" accept=".xlsx,.xlsm,.csv,.tsv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setApplied(null); }} disabled={busy} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={btn} onClick={() => void submit("preview")} disabled={busy || !file || !sessionId}>{busy ? "処理中…" : "プレビュー"}</button>
        <button
          style={btnPrimary}
          onClick={() => void submit("apply")}
          disabled={busy || !preview || preview.counts.valid === 0 || !preview.oa_liff_configured}
          title={!preview ? "先にプレビュー" : (!preview.oa_liff_configured ? "OA の LIFF ID が未設定です" : "")}
        >
          適用して URL を発行
        </button>
      </div>

      {/* Preview: 件数のみ（URL なし） */}
      {preview && !applied && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>プレビュー（{preview.file.name} / {preview.file.format} / Session: {preview.session.name}）</div>
          {!preview.oa_liff_configured && (
            <div style={{ background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
              この OA の LIFF ID が未設定のため URL を発行できません。先に LIFF 設定を行ってください。
            </div>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>読込行数: <b>{preview.counts.total}</b> / 有効: <b>{preview.counts.valid}</b> / エラー: <b style={{ color: preview.counts.error ? "#b91c1c" : undefined }}>{preview.counts.error}</b></li>
            <li>新規 Team: <b>{preview.counts.teams_create}</b> / 更新 Team: <b>{preview.counts.teams_update}</b></li>
            <li>新規 URL 発行予定: <b>{preview.counts.tokens_issue}</b> / 発行済み skip: <b>{preview.counts.tokens_skip}</b></li>
          </ul>
          {preview.counts.error > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, color: "#b91c1c" }}>エラー行:</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "#b91c1c" }}>
                {preview.rows.filter((r) => r.plan === "error").slice(0, 30).map((r) => (
                  <li key={r.rowIndex}>行 {r.rowIndex}（{r.ticketId || "TicketID空"}）: {r.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Apply: URL 一覧 + CSV */}
      {applied && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <div style={{ background: "#fffbeb", color: "#92400e", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
            この LIFF URL は<strong>今回のみ取得できます</strong>。DB には保存されません。再取得する場合は該当行を「再発行」してください。
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div>発行: <b style={{ color: "#06C755" }}>{applied.counts.issued}</b> / skip: <b>{applied.counts.skipped}</b> / 失敗: <b style={{ color: applied.counts.failed ? "#b91c1c" : undefined }}>{applied.counts.failed}</b></div>
            <button style={btnPrimary} onClick={downloadCsv}>URL 付き CSV をダウンロード（UTF-8 BOM）</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "6px 8px" }}>TicketID</th>
                  <th style={{ padding: "6px 8px" }}>結果</th>
                  <th style={{ padding: "6px 8px" }}>LIFF URL</th>
                  <th style={{ padding: "6px 8px" }}>有効期限</th>
                  <th style={{ padding: "6px 8px" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {applied.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>{r.ticketId}</td>
                    <td style={{ padding: "6px 8px", color: r.result === "failed" ? "#b91c1c" : r.result === "issued" ? "#06842f" : "#6b7280" }}>
                      {r.result === "issued" ? "発行" : r.result === "skipped" ? "発行済み(skip)" : "失敗"}{r.error ? `（${r.error}）` : ""}
                    </td>
                    <td style={{ padding: "6px 8px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.url ? <span style={{ color: "#374151" }}>{r.url}</span> : <span style={{ color: "#9ca3af" }}>—</span>}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#6b7280" }}>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("ja-JP") : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {r.url && <button style={btn} onClick={() => copy(r.url!)}>コピー</button>}
                      {r.result === "skipped" && <button style={btn} onClick={() => void submit("apply", [r.ticketId])} disabled={busy}>再発行</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
