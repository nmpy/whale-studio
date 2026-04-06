"use client";

// src/app/admin/resume/page.tsx
// 再開導線 UX 分析（プラットフォームオーナー専用）
//
// 集計ソース: event_logs
//   resume_choice_shown / resume_choice_selected / resume_completed
//
// 見られること:
//   - 離脱→再開→完走のファネル全体像
//   - 「再開」vs「やり直し」の選択内訳
//   - フェーズ別の離脱・完走傾向（どこで詰まっているか）
//   - resumeSummary（再開時あらすじ）設定の有無による完走率差分

import { useEffect, useState } from "react";
import { getDevToken }         from "@/lib/api-client";
import type { ResumeAnalytics } from "@/app/api/analytics/resume/route";

// ── ヘルパー ──────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization:  `Bearer ${getDevToken()}`,
  };
}

function pctColor(pct: number): string {
  if (pct >= 60) return "#16a34a";
  if (pct >= 30) return "#d97706";
  return "#dc2626";
}

// フェーズ ID を短縮表示（先頭8文字）
function shortId(id: string): string {
  return id.slice(0, 8) + "…";
}

// ── 共通コンポーネント ────────────────────────────────────────────────────

function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
        {label}
      </h3>
      {sub && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** 大きな数字カード（ファネル指標用） */
function MetricCard({
  label, value, sub, accent,
}: {
  label:   string;
  value:   string;
  sub?:    string;
  accent?: string;
}) {
  return (
    <div style={{
      flex:         "1 1 140px",
      minWidth:     120,
      background:   "var(--surface)",
      border:       "1px solid var(--border-light)",
      borderRadius: "var(--radius-md, 10px)",
      padding:      "16px 18px",
    }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 800, color: accent ?? "var(--text-primary)", margin: 0, lineHeight: 1 }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** 水平バー（2値比較用） */
function SplitBar({
  leftLabel, leftCount, rightLabel, rightCount,
  leftColor, rightColor,
}: {
  leftLabel:   string;
  leftCount:   number;
  rightLabel:  string;
  rightCount:  number;
  leftColor:   string;
  rightColor:  string;
}) {
  const total = leftCount + rightCount;
  const leftPct  = total > 0 ? Math.round((leftCount  / total) * 100) : 0;
  const rightPct = total > 0 ? 100 - leftPct : 0;

  return (
    <div>
      {/* ラベル行 */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: leftColor, display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{leftLabel}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{leftCount.toLocaleString()}件</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: leftColor }}>{leftPct}%</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: rightColor }}>{rightPct}%</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{rightCount.toLocaleString()}件</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{rightLabel}</span>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: rightColor, display: "inline-block", flexShrink: 0 }} />
        </div>
      </div>
      {/* バー */}
      <div style={{ height: 12, borderRadius: 99, display: "flex", overflow: "hidden", background: "#e5e7eb" }}>
        <div style={{
          width:      `${leftPct}%`,
          background: leftColor,
          transition: "width 0.5s ease",
          minWidth:   leftCount > 0 ? 4 : 0,
        }} />
        <div style={{
          flex:       1,
          background: rightColor,
          transition: "width 0.5s ease",
          minWidth:   rightCount > 0 ? 4 : 0,
          opacity:    0.7,
        }} />
      </div>
    </div>
  );
}

/** スケルトンカード */
function SkeletonCard({ height = 100 }: { height?: number }) {
  return <div className="skeleton" style={{ height, borderRadius: 10 }} />;
}

// ── メインコンポーネント ───────────────────────────────────────────────────

export default function AdminResumePage() {
  const [data,    setData]    = useState<ResumeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/resume", { headers: authHeaders() });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.data ?? json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── ヘッダー（常時表示）────────────────────────────────────────────────
  const header = (
    <div className="page-header" style={{ marginBottom: 20 }}>
      <div>
        <h2 style={{ margin: 0 }}>再開分析</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          途中離脱ユーザーの「再開」行動を集計します（resume_choice_shown / selected / completed）
        </p>
      </div>
      <button
        className="btn btn-ghost"
        onClick={load}
        disabled={loading}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {loading
          ? <span className="spinner" style={{ width: 14, height: 14 }} />
          : <span style={{ fontSize: 14 }}>↻</span>
        }
        更新
      </button>
    </div>
  );

  if (error) {
    return (
      <>
        {header}
        <div className="alert alert-error">
          {error}
          <button
            onClick={load}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      </>
    );
  }

  if (loading && !data) {
    return (
      <>
        {header}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} height={100} />)}
        </div>
        <SkeletonCard height={90} />
        <div style={{ marginTop: 16 }}><SkeletonCard height={160} /></div>
        <div style={{ marginTop: 16 }}><SkeletonCard height={120} /></div>
      </>
    );
  }

  if (!data) return null;

  const { total_events, funnel, by_phase, summary_effect } = data;

  return (
    <>
      {header}

      {/* ── 合計バッジ ──────────────────────────────────────────────────── */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        marginBottom: 20,
        padding:      "10px 16px",
        background:   "var(--color-primary-soft, #EAF4F1)",
        border:       "1px solid #b9ddd6",
        borderRadius: "var(--radius-md, 10px)",
        fontSize:     13,
      }}>
        <span style={{ color: "var(--color-primary, #2F6F5E)" }}>
          <strong>{total_events.toLocaleString()} 件</strong>のイベントを集計しています
        </span>
        {total_events === 0 && (
          <span style={{ color: "#6b7280", marginLeft: 4 }}>
            （まだデータがありません — 途中離脱ユーザーが再開選択肢を見ると記録されます）
          </span>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          セクション 1: 再開ファネル
          離脱 → 選択肢提示 → 再開選択 → 完走 の流れ
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 18px", marginBottom: 16 }}>
        <SectionHeader
          label="再開ファネル"
          sub="途中離脱ユーザーが選択肢を見てから完走するまでの流れ"
        />

        {/* 3 指標カード */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <MetricCard
            label="再開提示数"
            value={funnel.shown.toLocaleString()}
            sub="選択肢を見たユーザー数"
          />
          <MetricCard
            label="選択率"
            value={`${funnel.selection_rate}%`}
            sub={`${funnel.selected_total.toLocaleString()} 件が選択`}
            accent={pctColor(funnel.selection_rate)}
          />
          <MetricCard
            label="再開後完走率"
            value={`${funnel.completion_rate}%`}
            sub={`${funnel.completed.toLocaleString()} 件が完走`}
            accent={pctColor(funnel.completion_rate)}
          />
        </div>

        {/* ファネル矢印 */}
        {funnel.shown > 0 && (
          <div style={{
            display:    "flex",
            alignItems: "center",
            gap:        6,
            fontSize:   12,
            color:      "var(--text-muted)",
            flexWrap:   "wrap",
          }}>
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>
              {funnel.shown.toLocaleString()} 提示
            </span>
            <span>→</span>
            <span style={{ fontWeight: 700, color: "#2563eb" }}>
              {funnel.selected_total.toLocaleString()} 選択（{funnel.selection_rate}%）
            </span>
            <span>→</span>
            <span style={{ fontWeight: 700, color: "#0369a1" }}>
              {funnel.selected_resume.toLocaleString()} 再開（{funnel.resume_rate}%）
            </span>
            <span>→</span>
            <span style={{ fontWeight: 700, color: "#16a34a" }}>
              {funnel.completed.toLocaleString()} 完走（{funnel.completion_rate}%）
            </span>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          セクション 2: 選択内訳
          「途中から再開」vs「最初からやり直す」
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 18px", marginBottom: 16 }}>
        <SectionHeader
          label="選択内訳"
          sub={`選択した ${funnel.selected_total.toLocaleString()} 件の内訳 — 再開志向が高いほど離脱ユーザーの継続意欲が強い`}
        />

        {funnel.selected_total === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>データなし</p>
        ) : (
          <SplitBar
            leftLabel="途中から再開"
            leftCount={funnel.selected_resume}
            rightLabel="最初からやり直す"
            rightCount={funnel.selected_restart}
            leftColor="#0369a1"
            rightColor="#6b7280"
          />
        )}

        {/* サブ数値 */}
        {funnel.selected_total > 0 && (
          <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>途中から再開</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#0369a1", margin: "2px 0 0" }}>
                {funnel.selected_resume.toLocaleString()} 件
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>
                  {funnel.resume_rate}%
                </span>
              </p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>最初からやり直す</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#6b7280", margin: "2px 0 0" }}>
                {funnel.selected_restart.toLocaleString()} 件
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>
                  {funnel.selected_total > 0 ? 100 - funnel.resume_rate : 0}%
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          セクション 3: フェーズ別再開分析
          どこで離脱が多いか / どこの完走率が低いか
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 12px", marginBottom: 16 }}>
        <SectionHeader
          label="フェーズ別再開分析"
          sub="再開数が多いフェーズ＝離脱が起きやすい箇所。完走率が低い場合は難易度・シナリオ設計を見直すサイン。"
        />

        {by_phase.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>データなし</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["フェーズ ID", "再開数", "完走数", "完走率"].map((h) => (
                    <th key={h} style={{
                      textAlign:    "left",
                      padding:      "6px 10px",
                      fontSize:     11,
                      fontWeight:   700,
                      color:        "var(--text-muted)",
                      borderBottom: "2px solid var(--border-light)",
                      whiteSpace:   "nowrap",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {by_phase.map((row, i) => (
                  <tr key={row.phase_id} style={{ background: i % 2 === 0 ? "transparent" : "var(--gray-50, #f9fafb)" }}>
                    <td style={{ padding: "9px 10px", color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12, borderBottom: "1px solid var(--border-light)" }}>
                      <span title={row.phase_id}>{shortId(row.phase_id)}</span>
                    </td>
                    <td style={{ padding: "9px 10px", fontWeight: 700, color: "#0369a1", borderBottom: "1px solid var(--border-light)" }}>
                      {row.resume_count.toLocaleString()}
                    </td>
                    <td style={{ padding: "9px 10px", fontWeight: 700, color: "#16a34a", borderBottom: "1px solid var(--border-light)" }}>
                      {row.completed_count.toLocaleString()}
                    </td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border-light)" }}>
                      {row.resume_count > 0 ? (
                        <span style={{
                          fontWeight:   700,
                          color:        pctColor(row.completion_rate),
                          fontSize:     13,
                        }}>
                          {row.completion_rate}%
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              フェーズ ID はホバーで全文表示。管理画面のシナリオページで確認できます。
            </p>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          セクション 4: resumeSummary 効果
          「再開時あらすじ」設定の有無で再開率・完走率に差があるか
      ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ padding: "16px 20px 18px", marginBottom: 16 }}>
        <SectionHeader
          label="再開時あらすじの効果"
          sub="フェーズに「再開時あらすじ」が設定されていた場合とそうでない場合の完走率比較"
        />

        {summary_effect.with_summary.resume_count === 0 && summary_effect.without_summary.resume_count === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>データなし（まだ再開が発生していません）</p>
        ) : (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {/* あり */}
            <div style={{
              flex:         "1 1 200px",
              background:   "#f0f9ff",
              border:       "1px solid #bae6fd",
              borderRadius: "var(--radius-md, 10px)",
              padding:      "14px 16px",
            }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#0369a1", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                あらすじあり
              </p>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: 10, color: "#0369a1", margin: 0 }}>再開数</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#0369a1", margin: "2px 0 0" }}>
                    {summary_effect.with_summary.resume_count.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: "#0369a1", margin: 0 }}>完走率</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: pctColor(summary_effect.with_summary.completion_rate), margin: "2px 0 0" }}>
                    {summary_effect.with_summary.completion_rate}%
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: "#0369a1", margin: 0 }}>完走数</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#16a34a", margin: "2px 0 0" }}>
                    {summary_effect.with_summary.completed_count.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* なし */}
            <div style={{
              flex:         "1 1 200px",
              background:   "#f9fafb",
              border:       "1px solid var(--border-light)",
              borderRadius: "var(--radius-md, 10px)",
              padding:      "14px 16px",
            }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                あらすじなし
              </p>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>再開数</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "var(--text-secondary)", margin: "2px 0 0" }}>
                    {summary_effect.without_summary.resume_count.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>完走率</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: pctColor(summary_effect.without_summary.completion_rate), margin: "2px 0 0" }}>
                    {summary_effect.without_summary.completion_rate}%
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>完走数</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#16a34a", margin: "2px 0 0" }}>
                    {summary_effect.without_summary.completed_count.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 差分サマリ */}
        {summary_effect.with_summary.resume_count > 0 && summary_effect.without_summary.resume_count > 0 && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
            あらすじあり完走率{" "}
            <strong style={{ color: pctColor(summary_effect.with_summary.completion_rate) }}>
              {summary_effect.with_summary.completion_rate}%
            </strong>
            {" "}vs なし{" "}
            <strong style={{ color: pctColor(summary_effect.without_summary.completion_rate) }}>
              {summary_effect.without_summary.completion_rate}%
            </strong>
            {" "}
            {summary_effect.with_summary.completion_rate > summary_effect.without_summary.completion_rate
              ? "— あらすじ設定が完走率向上に寄与している可能性があります。"
              : summary_effect.with_summary.completion_rate === summary_effect.without_summary.completion_rate
              ? "— 現時点では差分が出ていません。"
              : "— あらすじなしの方が完走率が高いため、コンテンツ内容や対象フェーズを見直してみましょう。"}
          </p>
        )}
      </div>
    </>
  );
}
