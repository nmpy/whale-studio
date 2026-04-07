"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getAuthHeaders } from "@/lib/api-client";
import { useToast } from "@/components/Toast";

// ────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────

interface SyncResult {
  dry_run:        boolean;
  total:          number;
  applied_count:  number;
  skipped_count:  number;
  applied: Array<{
    richmenu_id:       string;
    line_rich_menu_id: string;
    is_default:        boolean;
    visible_phase:     string | null;
  }>;
  skipped: Array<{ richmenu_id: string; reason: string }>;
  message?: string;
}

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────

const VISIBLE_PHASE_LABELS: Record<string, string> = {
  start:   "開始フェーズ",
  playing: "プレイ中",
  cleared: "クリア後",
  none:    "常時（デフォルト）",
};

// ────────────────────────────────────────────────
// ページコンポーネント
// ────────────────────────────────────────────────

export default function RichMenuSyncPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { showToast } = useToast();

  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [workId,        setWorkId]        = useState("");
  const [size,          setSize]          = useState<"compact" | "full">("compact");
  const [dryRun,        setDryRun]        = useState(true);

  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<SyncResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  async function handleSync() {
    if (!spreadsheetId.trim()) {
      showToast("スプレッドシート ID を入力してください", "error");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/oas/${oaId}/richmenu-sync`, {
        method:  "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          spreadsheet_id: spreadsheetId.trim(),
          work_id:        workId.trim() || undefined,
          size,
          dry_run:        dryRun,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }

      setResult(json.data as SyncResult);
      showToast(
        dryRun
          ? `ドライランが完了しました（${json.data.applied_count} 件確認）`
          : `同期が完了しました（${json.data.applied_count} 件適用）`,
        "success"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "同期に失敗しました";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            { label: "Google Sheets リッチメニュー同期" },
          ]} />
          <h2>Google Sheets → LINE リッチメニュー同期</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Google Spreadsheet の RichMenus / RichMenuItems シートを読み込み、
            LINE にリッチメニューを作成・適用します。
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href={`/oas/${oaId}/richmenu-editor`} className="btn btn-ghost" style={{ fontSize: 13 }}>
            🎨 カスタムエディター
          </Link>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>

        {/* ── 左: 設定フォーム ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 接続設定 */}
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 14, color: "#374151", marginBottom: 14 }}>
              スプレッドシート設定
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  スプレッドシート ID <span style={{ color: "#ef4444" }}>*</span>
                </span>
                <input
                  type="text"
                  className="input"
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                  style={{ fontFamily: "monospace", fontSize: 13 }}
                />
                <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 4 }}>
                  スプレッドシート URL の <code>/d/</code> と <code>/edit</code> の間の文字列
                </span>
              </label>

              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  work_id で絞り込み（任意）
                </span>
                <input
                  type="text"
                  className="input"
                  value={workId}
                  onChange={(e) => setWorkId(e.target.value)}
                  placeholder="例: W001（省略時は全メニュー対象）"
                />
              </label>

              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                  メニューサイズ
                </span>
                <select className="input" value={size} onChange={(e) => setSize(e.target.value as "compact" | "full")}>
                  <option value="compact">コンパクト (2500×843)</option>
                  <option value="full">フル (2500×1686)</option>
                </select>
              </label>

              {/* ドライランスイッチ */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 14px",
                background: dryRun ? "#fefce8" : "#f0fdf4",
                border: `1px solid ${dryRun ? "#fde047" : "#86efac"}`,
                borderRadius: 10,
              }}>
                <input
                  type="checkbox"
                  id="dryRun"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <label htmlFor="dryRun" style={{ cursor: "pointer", flex: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: dryRun ? "#92400e" : "#15803d" }}>
                    {dryRun ? "ドライラン（確認のみ）" : "実際に LINE へ適用"}
                  </span>
                  <p style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                    {dryRun
                      ? "LINE API は呼び出しません。設定内容の確認のみ行います。"
                      : "LINE にリッチメニューを作成・適用します。まずドライランで確認することを推奨します。"}
                  </p>
                </label>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                className={`btn ${dryRun ? "btn-ghost" : "btn-primary"}`}
                style={{ width: "100%", fontSize: 14 }}
                disabled={loading}
                onClick={handleSync}
              >
                {loading ? (
                  <><span className="spinner" /> {dryRun ? "確認中…" : "同期中…"}</>
                ) : dryRun ? "ドライランを実行" : "LINE に同期する"}
              </button>
            </div>
          </div>

          {/* エラー */}
          {error && (
            <div className="alert alert-error">
              <strong>エラー:</strong> {error}
            </div>
          )}

          {/* 結果 */}
          {result && (
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
                    {result.dry_run ? "ドライラン完了" : "同期完了"}
                  </p>
                  <p style={{ fontSize: 12, color: "#6b7280" }}>
                    合計 {result.total} 件 /{" "}
                    {result.dry_run ? "確認" : "適用"} {result.applied_count} 件 /{" "}
                    スキップ {result.skipped_count} 件
                  </p>
                </div>
              </div>

              {result.message && (
                <div style={{
                  padding: "10px 12px", background: "#fef9c3",
                  border: "1px solid #fde047", borderRadius: 8,
                  fontSize: 12, color: "#92400e", marginBottom: 12,
                }}>
                  {result.message}
                </div>
              )}

              {/* 適用済み */}
              {result.applied.length > 0 && (
                <>
                  <p style={{ fontWeight: 600, fontSize: 12, color: "#374151", marginBottom: 8 }}>
                    {result.dry_run ? "確認済み" : "適用済み"} ({result.applied.length})
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {result.applied.map((item) => (
                      <div key={item.richmenu_id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px",
                        background: "#f0fdf4", border: "1px solid #86efac",
                        borderRadius: 8, fontSize: 12,
                      }}>
                        <span style={{ color: "#16a34a", fontSize: 16 }}>✓</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 700, color: "#111827" }}>
                            {item.richmenu_id}
                          </span>
                          {item.visible_phase && (
                            <span style={{
                              marginLeft: 8, fontSize: 11,
                              background: "#e0f2fe", color: "#0369a1",
                              padding: "1px 7px", borderRadius: 20,
                            }}>
                              {VISIBLE_PHASE_LABELS[item.visible_phase] ?? item.visible_phase}
                            </span>
                          )}
                          {item.is_default && (
                            <span style={{
                              marginLeft: 6, fontSize: 11,
                              background: "#f0fdf4", color: "#15803d",
                              padding: "1px 7px", borderRadius: 20,
                              border: "1px solid #86efac",
                            }}>
                              デフォルト
                            </span>
                          )}
                        </div>
                        {!result.dry_run && (
                          <code style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace" }}>
                            {item.line_rich_menu_id.slice(0, 20)}…
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* スキップ */}
              {result.skipped.length > 0 && (
                <>
                  <p style={{ fontWeight: 600, fontSize: 12, color: "#374151", marginBottom: 8 }}>
                    スキップ ({result.skipped.length})
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {result.skipped.map((item) => (
                      <div key={item.richmenu_id} style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        padding: "8px 12px",
                        background: "#fff7ed", border: "1px solid #fdba74",
                        borderRadius: 8, fontSize: 12,
                      }}>
                        <span style={{ color: "#f97316", fontSize: 16, flexShrink: 0 }}>!</span>
                        <div>
                          <span style={{ fontWeight: 700, color: "#111827" }}>{item.richmenu_id}</span>
                          <p style={{ color: "#6b7280", marginTop: 2 }}>{item.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── 右: ガイド ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 前提条件 */}
          <div className="card" style={{ background: "#f0f9ff", borderColor: "#bae6fd" }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: "#0369a1", marginBottom: 10 }}>
              前提条件
            </p>
            <ol style={{ fontSize: 12, color: "#374151", paddingLeft: 18, lineHeight: 2 }}>
              <li>スプレッドシートを「リンクを知っている全員が閲覧可能」に設定</li>
              <li><code>GOOGLE_SHEETS_API_KEY</code> を <code>.env.local</code> に追加</li>
              <li>スプレッドシートに <code>RichMenus</code> / <code>RichMenuItems</code> シートが存在すること</li>
            </ol>
            <div style={{
              marginTop: 10, padding: "10px 12px",
              background: "#fff", borderRadius: 8,
              border: "1px solid #bae6fd", fontSize: 12,
            }}>
              <p style={{ fontWeight: 600, color: "#0369a1", marginBottom: 4 }}>.env.local に追加:</p>
              <code style={{ color: "#374151", display: "block" }}>
                GOOGLE_SHEETS_API_KEY=AIza...
              </code>
              <p style={{ color: "#6b7280", marginTop: 6, fontSize: 11 }}>
                または非公開シートの場合は <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>
              </p>
            </div>
          </div>

          {/* シート構成 */}
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 10 }}>
              シート構成
            </p>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontWeight: 600, fontSize: 12, color: "#6366f1", marginBottom: 6 }}>
                RichMenus シート
              </p>
              <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 2 }}>
                {["richmenu_id","work_id","name","template_type","chat_bar_text","is_default","image_url","visible_phase"].map((col) => (
                  <div key={col}>
                    <code style={{
                      background: "#f3f4f6", padding: "1px 5px",
                      borderRadius: 3, color: "#374151",
                    }}>{col}</code>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontWeight: 600, fontSize: 12, color: "#22c55e", marginBottom: 6 }}>
                RichMenuItems シート
              </p>
              <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 2 }}>
                {["richmenu_id","slot_no","label","action_type","action_value","is_active"].map((col) => (
                  <div key={col}>
                    <code style={{
                      background: "#f3f4f6", padding: "1px 5px",
                      borderRadius: 3, color: "#374151",
                    }}>{col}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* template_type 一覧 */}
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 10 }}>
              対応 template_type
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              {[
                { type: "3col",       desc: "3 列均等（slot 1-3）" },
                { type: "2col",       desc: "2 列均等（slot 1-2）" },
                { type: "4grid",      desc: "2×2 グリッド（slot 1-4）" },
                { type: "6grid",      desc: "3×2 グリッド（slot 1-6）" },
                { type: "2row",       desc: "2 行均等（slot 1-2）" },
                { type: "3col-2row",  desc: "3 列 × 2 行（= 6grid）" },
                { type: "fullscreen", desc: "全面 1 ボタン" },
              ].map(({ type, desc }) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{
                    background: "#f3f4f6", padding: "2px 8px",
                    borderRadius: 4, color: "#374151",
                    fontWeight: 600, flexShrink: 0,
                  }}>{type}</code>
                  <span style={{ color: "#6b7280" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* visible_phase */}
          <div className="card" style={{ background: "#faf5ff", borderColor: "#d8b4fe" }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: "#7c3aed", marginBottom: 10 }}>
              visible_phase（フェーズ別表示）
            </p>
            <p style={{ fontSize: 12, color: "#374151", marginBottom: 8 }}>
              ユーザーがフェーズを進むと自動的にリッチメニューが切り替わります。
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              {Object.entries(VISIBLE_PHASE_LABELS).map(([key, label]) => (
                <div key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{
                    background: "#ede9fe", padding: "1px 8px",
                    borderRadius: 4, color: "#6d28d9",
                  }}>{key}</code>
                  <span style={{ color: "#6b7280" }}>→ {label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
