"use client";

// src/app/oas/[id]/live/admin/EscapeIdImportSection.tsx
//   ESCAPE.ID 予約データ取込 UI（xlsx/xlsm/csv/tsv）。既存の参加者 CSV 取込とは独立したコンポーネント。
//   - 対象 Session は運営が明示選択（自動生成しない）。
//   - Preview は件数のみ（URL 生成なし）。Apply 時のみ token 発行 → LIFF URL を返す。
//   - 【重要】平文 LIFF URL は **React state に保持しない**（useRef のみ・DB 非保存・ログ/監視非送信）。
//     URL は Apply レスポンス → ref → CSV/コピー のみ。再取得不可（必要なら再発行）。

import { useEffect, useMemo, useRef, useState } from "react";
import { buildTicketResultCsv, type TicketResultRow } from "@/lib/live-ticket-import";

type SessionOpt = { id: string; work_id: string | null; name: string; status: string; starts_at: string | null };

type PreviewRow = { rowIndex: number; ticketId: string; ticketType: string; groupType: string | null; plan: "issue" | "skip" | "error"; dateMismatch: boolean; error: string; warnings: string[] };
type PreviewResp = {
  mode: "preview";
  file: { name: string; format: string; total_rows: number; sheet_name: string | null; non_empty_sheets: number };
  oa_liff_configured: boolean;
  session: { id: string; name: string; status: string; starts_at: string | null };
  counts: { total: number; valid: number; error: number; teams_create: number; teams_update: number; tokens_issue: number; tokens_skip: number; date_mismatch: number };
  warnings: { multi_sheet: string | null; date_mismatch: string | null };
  rows: PreviewRow[];
};
type ApplyCounts = { total: number; valid: number; created: number; updated: number; issued: number; skipped: number; reissued: number; validationFailed: number; applyFailed: number };
type ApplyResp = { mode: "apply"; session: { id: string; name: string }; counts: ApplyCounts; rows: TicketResultRow[] };
/** state 用: URL を持たない結果サマリ（平文 URL は state に入れない）。 */
type AppliedSummary = { counts: ApplyCounts; rows: Array<{ ticketId: string; result: TicketResultRow["result"]; error: string; expiresAt: string | null; hasUrl: boolean }> };

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
  const [applied, setApplied] = useState<AppliedSummary | null>(null);
  const [busy, setBusy] = useState(false);
  // 平文 URL 付き結果は state ではなく ref に一時保持（レンダー・監視・永続化の対象外）。
  const urlRowsRef = useRef<TicketResultRow[]>([]);
  // unmount 時に平文 URL の参照を明示的に破棄（GC 前に到達不能化）。
  useEffect(() => () => { urlRowsRef.current = []; }, []);

  const workSessions = useMemo(
    () => sessions.filter((s) => s.work_id === workId && s.status !== "ended"),
    [sessions, workId],
  );

  // 前回の結果（URL 付き ref を含む）を破棄。Session/ファイル変更・新規実行時に呼ぶ。
  const clearResults = () => { setPreview(null); setApplied(null); urlRowsRef.current = []; };

  const submit = async (mode: "preview" | "apply", reissueIds?: string[]) => {
    if (!workId) { onError("先に対象 work を選択してください"); return; }
    if (!sessionId) { onError("対象 Session を選択してください"); return; }
    if (!file) { onError("ファイルを選択してください"); return; }
    setBusy(true);
    // 実行開始時に前回結果を破棄（失敗しても古い成功 URL を再ダウンロードできないようにする）。
    if (mode === "apply") clearResults(); else { setApplied(null); urlRowsRef.current = []; }
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
      if (mode === "preview") { setPreview(json.data as PreviewResp); setApplied(null); urlRowsRef.current = []; }
      else {
        const data = json.data as ApplyResp;
        urlRowsRef.current = data.rows;   // 平文 URL は ref のみ（state には入れない）
        setApplied({
          counts: data.counts,
          rows: data.rows.map((r) => ({ ticketId: r.ticketId, result: r.result, error: r.error, expiresAt: r.expiresAt, hasUrl: !!r.url })),
        });
        onApplied?.();
      }
    } catch {
      onError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    if (urlRowsRef.current.length === 0) return;
    const csv = buildTicketResultCsv(urlRowsRef.current);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `escapeid-liff-urls-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(href);
  };
  const copy = (ticketId: string) => {
    const r = urlRowsRef.current.find((x) => x.ticketId === ticketId && x.url);
    if (r?.url) void navigator.clipboard?.writeText(r.url);
  };

  const resetFile = (f: File | null) => { setFile(f); clearResults(); };
  const onSessionChange = (id: string) => { setSessionId(id); clearResults(); };

  return (
    <section style={{ ...box, marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>ESCAPE.ID 予約一覧の取込 → LIFF URL 生成</h3>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px" }}>
        Excel（.xlsx/.xlsm）/ CSV / TSV を取込み、1 行 = 1 チケット = 1 チーム を作成し、チケットごとの LIFF URL を発行します。
        参加者は作られません（LINE 連携時に作成）。CSV 内の公演日時は参考情報で、実際の紐付けは下で選んだ Session です（Session は自動生成しません）。
      </p>

      <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>対象 Session（必須・自動生成しません）</label>
      {workSessions.length === 0 ? (
        <p style={{ fontSize: 13, color: "#b45309" }}>この work に選択可能な Session がありません。先に Session を作成してください。</p>
      ) : (
        <select value={sessionId} onChange={(e) => onSessionChange(e.target.value)} style={{ ...btn, cursor: "pointer", minWidth: 320 }} disabled={busy}>
          <option value="">— Session を選択 —</option>
          {workSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.status}{s.starts_at ? " / " + new Date(s.starts_at).toLocaleString("ja-JP") : ""}）
            </option>
          ))}
        </select>
      )}

      <div style={{ marginTop: 12 }}>
        <input type="file" accept=".xlsx,.xlsm,.csv,.tsv" onChange={(e) => resetFile(e.target.files?.[0] ?? null)} disabled={busy} />
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
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            プレビュー（{preview.file.name} / {preview.file.format}{preview.file.sheet_name ? ` / シート「${preview.file.sheet_name}」` : ""} / Session: {preview.session.name}）
          </div>
          {!preview.oa_liff_configured && (
            <div style={{ background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
              この OA の LIFF ID が未設定のため URL を発行できません。先に LIFF 設定を行ってください。
            </div>
          )}
          {preview.warnings.multi_sheet && <div style={{ background: "#fffbeb", color: "#92400e", borderRadius: 8, padding: "6px 12px", marginBottom: 6 }}>{preview.warnings.multi_sheet}</div>}
          {preview.warnings.date_mismatch && <div style={{ background: "#fffbeb", color: "#92400e", borderRadius: 8, padding: "6px 12px", marginBottom: 6 }}>{preview.warnings.date_mismatch}</div>}
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>読込行数: <b>{preview.counts.total}</b> / 有効: <b>{preview.counts.valid}</b> / エラー: <b style={{ color: preview.counts.error ? "#b91c1c" : undefined }}>{preview.counts.error}</b></li>
            <li>新規 Team: <b>{preview.counts.teams_create}</b> / 更新 Team: <b>{preview.counts.teams_update}</b></li>
            <li>新規 URL 発行予定: <b>{preview.counts.tokens_issue}</b> / 発行済み skip: <b>{preview.counts.tokens_skip}</b></li>
          </ul>
          {preview.counts.error > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700, color: "#b91c1c" }}>エラー行（行番号 / チケット種別 / 理由）:</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "#b91c1c" }}>
                {preview.rows.filter((r) => r.plan === "error").slice(0, 50).map((r) => (
                  <li key={r.rowIndex}>行 {r.rowIndex}（{r.ticketId || "TicketID空"} / 種別「{r.ticketType || "空"}」）: {r.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Apply: 件数 + CSV（URL は state に保持せず ref から出力） */}
      {applied && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <div style={{ background: "#fffbeb", color: "#92400e", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
            この LIFF URL は<strong>今回のみ取得できます</strong>。DB には保存されません（画面にも残しません）。CSV をダウンロードしてください。再取得は該当行の「再発行」が必要です。
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <div>
              合計 {applied.counts.total} / 有効 {applied.counts.valid} / 新規Team <b>{applied.counts.created}</b> / 更新Team <b>{applied.counts.updated}</b> /
              発行 <b style={{ color: "#06C755" }}>{applied.counts.issued}</b> / 再発行 <b>{applied.counts.reissued}</b> / skip <b>{applied.counts.skipped}</b> /
              validationエラー <b style={{ color: applied.counts.validationFailed ? "#b91c1c" : undefined }}>{applied.counts.validationFailed}</b> /
              適用失敗 <b style={{ color: applied.counts.applyFailed ? "#b91c1c" : undefined }}>{applied.counts.applyFailed}</b>
            </div>
            <button style={btnPrimary} onClick={downloadCsv}>URL 付き CSV をダウンロード（UTF-8 BOM）</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "6px 8px" }}>TicketID</th>
                  <th style={{ padding: "6px 8px" }}>結果</th>
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
                    <td style={{ padding: "6px 8px", color: "#6b7280" }}>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("ja-JP") : "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {r.hasUrl && <button style={btn} onClick={() => copy(r.ticketId)}>URL コピー</button>}
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
