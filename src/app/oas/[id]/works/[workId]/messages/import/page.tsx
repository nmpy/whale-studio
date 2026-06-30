"use client";

// src/app/oas/[id]/works/[workId]/messages/import/page.tsx
// スプレッドシート取り込み画面（PR3）。テンプレDL → .xlsx 選択 → 検証 → 差分プレビュー → 取り込み。
// feature flag OFF / 権限なしは利用不可。PR2 API（validate/apply）を呼ぶ。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bootstrapApi, spreadsheetImportApi, getDevToken } from "@/lib/api-client";
import { isSpreadsheetImportEnabled, formatImportError } from "@/lib/spreadsheet-import/ui-text";
import type { ImportPreview, ImportResult, ImportError, ImportSummary } from "@/lib/spreadsheet-import/types";

type Envelope = { success: boolean; data?: unknown; error?: { code?: string; message?: string; details?: unknown } };
const fileError = (message: string): ImportError => ({ sheet: "file", row: 0, code: "PARSE_ERROR", message });

const SUMMARY_LABELS: { key: keyof ImportSummary; label: string }[] = [
  { key: "characters", label: "キャラクター" },
  { key: "phases", label: "フェーズ" },
  { key: "messages", label: "メッセージ" },
  { key: "transitions", label: "遷移" },
];
const ACTION_JP: Record<string, string> = { create: "新規", update: "更新", unchanged: "変更なし", error: "エラー" };

export default function SpreadsheetImportPage() {
  const params = useParams<{ id: string; workId: string }>();
  const oaId = params.id;
  const workId = params.workId;
  const enabled = isSpreadsheetImportEnabled();

  const [canEdit, setCanEdit] = useState(false);
  const [permLoaded, setPermLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<null | "validate" | "apply" | "template">(null);

  useEffect(() => {
    if (!enabled) { setPermLoaded(true); return; }
    bootstrapApi.messages(getDevToken(), oaId, workId)
      .then((d) => setCanEdit(d.permissions.can_edit))
      .catch(() => setCanEdit(false))
      .finally(() => setPermLoaded(true));
  }, [enabled, oaId, workId]);

  const resetResults = () => { setPreview(null); setErrors([]); setResult(null); };

  const onPickFile = (f: File | null) => { setFile(f); resetResults(); };

  const downloadTemplate = async () => {
    setBusy("template");
    try {
      const blob = await spreadsheetImportApi.downloadTemplate(oaId, workId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "spreadsheet-import-template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErrors([fileError("テンプレートのダウンロードに失敗しました")]);
    } finally { setBusy(null); }
  };

  const run = async (mode: "validate" | "apply") => {
    if (!file) return;
    setBusy(mode);
    try {
      const { status, json } = await spreadsheetImportApi.run(oaId, workId, file, mode);
      const env = (json ?? {}) as Envelope;
      if (mode === "validate") {
        if (status === 200 && env.success) {
          const pv = env.data as ImportPreview;
          setPreview(pv); setErrors(pv.errors ?? []); setResult(null);
        } else {
          setPreview(null); setErrors([fileError(env.error?.message ?? "検証に失敗しました")]);
        }
      } else {
        if (status === 200 && env.success) {
          setResult(env.data as ImportResult); setErrors([]);
        } else if (status === 422 && env.error?.details) {
          const pv = env.error.details as ImportPreview;
          setPreview(pv); setErrors(pv.errors ?? []); setResult(null);
        } else {
          setErrors([fileError(env.error?.message ?? "取り込みに失敗しました")]);
        }
      }
    } catch {
      setErrors([fileError("通信に失敗しました。時間をおいて再度お試しください")]);
    } finally { setBusy(null); }
  };

  const messagesHref = `/oas/${oaId}/works/${workId}/messages`;
  const canApply = !!preview && preview.ok && errors.length === 0 && !result;

  // ── flag OFF / 権限なし ──
  if (!enabled) {
    return (
      <div style={{ padding: 24 }}>
        <h2>スプレッドシート取り込み</h2>
        <p style={{ color: "#6b7280" }}>この機能は現在ご利用いただけません。</p>
        <Link href={messagesHref} className="btn">メッセージ一覧へ戻る</Link>
      </div>
    );
  }
  if (permLoaded && !canEdit) {
    return (
      <div style={{ padding: 24 }}>
        <h2>スプレッドシート取り込み</h2>
        <p style={{ color: "#6b7280" }}>この操作には編集権限が必要です。</p>
        <Link href={messagesHref} className="btn">メッセージ一覧へ戻る</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      <div className="page-header">
        <div>
          <h2>スプレッドシート取り込み</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            キャラクター・フェーズ・メッセージを一括登録
          </p>
        </div>
        <Link href={messagesHref} className="btn">メッセージ一覧へ戻る</Link>
      </div>

      {/* 説明 */}
      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16, fontSize: 13, lineHeight: 1.7 }}>
        <p style={{ margin: 0 }}>
          スプレッドシートから、キャラクター・フェーズ・メッセージを一括登録できます。取り込み前に内容を検証し、反映前に差分を確認できます。スプレッドシートに存在しない既存データは削除されません。
        </p>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#6b7280" }}>
          <li>取り込みは追加・更新のみです。既存データの削除は行いません。</li>
          <li>画像はURL指定のみ対応しています。画像ファイルのアップロードは今回の対象外です。</li>
          <li>開始フェーズを変更する場合は、既存の開始フェーズと競合しないようにしてください。</li>
        </ul>
      </div>

      {/* 手順 */}
      <ol style={{ fontSize: 13, color: "#374151", lineHeight: 1.9, paddingLeft: 20 }}>
        <li>
          テンプレートをダウンロードして入力します。{" "}
          <button type="button" className="btn" onClick={downloadTemplate} disabled={busy !== null}>
            {busy === "template" ? "ダウンロード中…" : "テンプレートをダウンロード"}
          </button>
        </li>
        <li style={{ marginTop: 8 }}>
          入力した .xlsx を選択します。{" "}
          <input type="file" accept=".xlsx" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
        </li>
        <li style={{ marginTop: 8 }}>
          内容を検証します。{" "}
          <button type="button" className="btn btn-primary" onClick={() => run("validate")} disabled={!file || busy !== null}>
            {busy === "validate" ? "検証中…" : "検証する"}
          </button>
        </li>
        <li style={{ marginTop: 8 }}>
          問題なければ取り込みます。{" "}
          <button type="button" className="btn btn-primary" onClick={() => run("apply")} disabled={!canApply || busy !== null}>
            {busy === "apply" ? "取り込み中…" : "取り込む"}
          </button>
        </li>
      </ol>

      {/* エラー表示 */}
      {errors.length > 0 && (
        <div style={{ marginTop: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: "#b91c1c" }}>修正が必要な項目があります（{errors.length}件）</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#7f1d1d", lineHeight: 1.7 }}>
            {errors.map((e, i) => <li key={i}>{formatImportError(e)}</li>)}
          </ul>
        </div>
      )}

      {/* 差分プレビュー（検証OK・未取り込み時） */}
      {preview && preview.ok && !result && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>反映プレビュー（「取り込む」を押すと反映されます）</p>
          <SummaryTable summary={preview.summary} />
          {preview.rows && preview.rows.length > 0 && <RowsTable rows={preview.rows} />}
        </div>
      )}

      {/* 取り込み成功 */}
      {result && (
        <div style={{ marginTop: 16, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: "#15803d" }}>取り込みが完了しました。</p>
          <SummaryTable summary={result.applied} />
          <div style={{ marginTop: 12 }}>
            <Link href={messagesHref} className="btn btn-primary">メッセージ一覧へ戻る</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTable({ summary }: { summary: ImportSummary }) {
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
      <thead>
        <tr>
          <th style={cell}>種類</th><th style={cell}>新規</th><th style={cell}>更新</th><th style={cell}>変更なし</th>
        </tr>
      </thead>
      <tbody>
        {SUMMARY_LABELS.map(({ key, label }) => (
          <tr key={key}>
            <td style={cell}>{label}</td>
            <td style={cellNum}>{summary[key].create}</td>
            <td style={cellNum}>{summary[key].update}</td>
            <td style={cellNum}>{summary[key].unchanged ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RowsTable({ rows }: { rows: NonNullable<ImportPreview["rows"]> }) {
  const SHEET_JP: Record<string, string> = { characters: "キャラクター", phases: "フェーズ", messages: "メッセージ" };
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 13, color: "#374151" }}>行ごとの内容を表示（{rows.length}件）</summary>
      <table style={{ borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={cell}>シート</th><th style={cell}>行</th><th style={cell}>キー</th><th style={cell}>処理</th><th style={cell}>変更フィールド</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={cell}>{SHEET_JP[r.sheet] ?? r.sheet}</td>
              <td style={cellNum}>{r.row}</td>
              <td style={cell}>{r.key}</td>
              <td style={cell}>{ACTION_JP[r.action] ?? r.action}</td>
              <td style={cell}>{r.changedFields?.join(", ") ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const cell: React.CSSProperties = { border: "1px solid #e5e7eb", padding: "4px 10px", textAlign: "left" };
const cellNum: React.CSSProperties = { border: "1px solid #e5e7eb", padding: "4px 10px", textAlign: "right" };
