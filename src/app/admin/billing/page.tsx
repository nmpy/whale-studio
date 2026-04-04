"use client";

// src/app/admin/billing/page.tsx
// 課金導線イベント分析（プラットフォームオーナー専用）

import { useEffect, useState } from "react";
import { getDevToken } from "@/lib/api-client";
import { BILLING_EVENTS, BILLING_EVENT_LABELS } from "@/lib/constants/billing-events";
import type { BillingEvent } from "@/lib/constants/billing-events";

// ── 課金導線の反応カード ──────────────────────────────────────────────────

interface BillingReactionData {
  totals: {
    pricing_view:            number;
    pricing_cta_click:       number;
    pricing_feedback_submit: number;
  };
  by_source: Record<string, number>;
}

const SOURCE_LABELS: Record<string, string> = {
  header:  "ヘッダー",
  banner:  "バナー",
  gate:    "ゲート",
  preview: "プレビュー後",
};

function BillingReactionCard() {
  const [data,    setData]    = useState<BillingReactionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/billing-events", {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j) => setData(j.data ?? j))
      .catch(() => {/* サイレント失敗 */})
      .finally(() => setLoading(false));
  }, []);

  const views   = data?.totals.pricing_view            ?? 0;
  const cta     = data?.totals.pricing_cta_click       ?? 0;
  const submit  = data?.totals.pricing_feedback_submit ?? 0;
  const ctaRate = views > 0 ? Math.round((cta    / views) * 100) : 0;
  const fbRate  = views > 0 ? Math.round((submit / views) * 100) : 0;

  const metrics: { label: string; value: number; sub?: string }[] = [
    { label: "プランページ到達",           value: views  },
    { label: "CTAクリック",               value: cta,    sub: `CTA率 ${ctaRate}%` },
    { label: "フィードバック送信",         value: submit, sub: `送信率 ${fbRate}%`  },
  ];

  const sourceEntries = data
    ? Object.entries(data.by_source).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="card" style={{ marginBottom: 20, padding: "20px 24px" }}>
      {/* 見出し */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 15 }}>📣</span>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          課金導線の反応
        </h3>
      </div>

      {loading ? (
        <div style={{ display: "flex", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ flex: 1, height: 64, borderRadius: 8 }} />
          ))}
        </div>
      ) : (
        <>
          {/* ── 主要数値 ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {metrics.map((m) => (
              <div key={m.label} style={{
                flex:          "1 1 120px",
                padding:       "14px 16px",
                background:    "var(--bg, #f9fafb)",
                border:        "1px solid var(--border-light, #e5e7eb)",
                borderRadius:  "var(--radius-md, 10px)",
                textAlign:     "center",
              }}>
                <div style={{
                  fontSize:    28,
                  fontWeight:  800,
                  color:       "var(--text-primary)",
                  letterSpacing: "-0.02em",
                  lineHeight:  1.1,
                }}>
                  {m.value.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {m.label}
                </div>
                {m.sub && (
                  <div style={{
                    fontSize:     11,
                    fontWeight:   700,
                    color:        "var(--color-primary, #2F6F5E)",
                    marginTop:    3,
                  }}>
                    {m.sub}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── 流入元内訳 ── */}
          {sourceEntries.length > 0 && (
            <div style={{
              padding:      "12px 16px",
              background:   "var(--bg, #f9fafb)",
              border:       "1px solid var(--border-light, #e5e7eb)",
              borderRadius: "var(--radius-sm, 6px)",
            }}>
              <p style={{
                fontSize:     11,
                fontWeight:   700,
                color:        "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}>
                流入元
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
                {sourceEntries.map(([src, cnt]) => (
                  <div key={src} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize:   11,
                      color:      "var(--text-secondary)",
                    }}>
                      {SOURCE_LABELS[src] ?? src}
                    </span>
                    <span style={{
                      fontSize:   13,
                      fontWeight: 700,
                      color:      "var(--text-primary)",
                    }}>
                      {cnt.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 型 ────────────────────────────────────────────────────────────────────

interface EventCount {
  event: BillingEvent;
  label: string;
  count: number;
}

interface FunnelData {
  view_to_cta:    number;
  cta_to_submit:  number;
  view_to_submit: number;
}

interface BillingAnalytics {
  counts: EventCount[];
  total:  number;
  funnel: FunnelData;
}

// ── 定数 ──────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<BillingEvent, string> = {
  pricing_view:               "👁",
  pricing_click_from_header:  "🔗",
  pricing_click_from_banner:  "📢",
  pricing_click_from_gate:    "🚪",
  pricing_click_from_preview: "▶️",
  pricing_cta_click:          "🔓",
  pricing_feedback_submit:    "✉️",
};

// ── ヘルパー ──────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization:  `Bearer ${getDevToken()}`,
  };
}

function barColor(count: number, maxCount: number): string {
  if (maxCount === 0) return "#e5e7eb";
  const ratio = count / maxCount;
  if (ratio >= 0.5) return "var(--color-primary, #2F6F5E)";
  if (ratio >= 0.2) return "#d97706";
  return "#dc2626";
}

// ── スケルトン行 ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div style={{
      display:       "flex",
      alignItems:    "center",
      gap:           12,
      padding:       "12px 0",
      borderBottom:  "1px solid #f3f4f6",
    }}>
      <div className="skeleton" style={{ width: 24, height: 20, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 160, height: 14 }} />
      <div className="skeleton" style={{ flex: 1, height: 8, borderRadius: 99 }} />
      <div className="skeleton" style={{ width: 60, height: 14 }} />
    </div>
  );
}

// ── 転換率バッジ ──────────────────────────────────────────────────────────

function RateBadge({ label, rate }: { label: string; rate: number }) {
  const color = rate >= 30 ? "#166534" : rate >= 10 ? "#92400e" : "#991b1b";
  const bg    = rate >= 30 ? "#dcfce7" : rate >= 10 ? "#fef3c7" : "#fee2e2";
  return (
    <div style={{
      display:       "flex",
      flexDirection: "column",
      alignItems:    "center",
      gap:           4,
      padding:       "12px 16px",
      background:    bg,
      borderRadius:  "var(--radius-md, 10px)",
      minWidth:      100,
    }}>
      <span style={{ fontSize: 20, fontWeight: 800, color }}>{rate}%</span>
      <span style={{ fontSize: 11, color, textAlign: "center", lineHeight: 1.4 }}>{label}</span>
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────────────────────────

export default function AdminBillingPage() {
  const [data,    setData]    = useState<BillingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/billing", { headers: authHeaders() });
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

  // ── ページヘッダー ──────────────────────────────────────────────────
  const header = (
    <div className="page-header" style={{ marginBottom: 20 }}>
      <div>
        <h2 style={{ margin: 0 }}>課金導線分析</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          /pricing ページへの流入・CTA クリック・フィードバック送信を集計します
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

  // ── エラー ──────────────────────────────────────────────────────────
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

  // ── ローディング ────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <>
        {header}
        <div className="card">
          <div style={{ padding: "4px 0 8px" }}>
            <div className="skeleton" style={{ width: 180, height: 14, marginBottom: 20 }} />
            {BILLING_EVENTS.map((e) => <SkeletonRow key={e} />)}
          </div>
        </div>
      </>
    );
  }

  if (!data) return null;

  const { counts, total, funnel } = data;
  const maxCount = Math.max(...counts.map((c) => c.count), 1);

  return (
    <>
      {header}

      {/* ── 課金導線の反応カード ── */}
      <BillingReactionCard />

      {/* ── 合計バッジ ── */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        marginBottom: 16,
        padding:      "10px 16px",
        background:   "var(--color-primary-soft, #EAF4F1)",
        border:       "1px solid #b9ddd6",
        borderRadius: "var(--radius-md, 10px)",
        fontSize:     13,
      }}>
        <span style={{ fontSize: 16 }}>📊</span>
        <span style={{ color: "var(--color-primary, #2F6F5E)" }}>
          <strong>{total.toLocaleString()} 件</strong> の課金導線イベントを集計しています
        </span>
        {total === 0 && (
          <span style={{ color: "#6b7280", marginLeft: 4 }}>
            （まだデータがありません）
          </span>
        )}
      </div>

      {/* ── 転換ファネル ── */}
      <div style={{
        display:      "flex",
        gap:          10,
        marginBottom: 20,
        flexWrap:     "wrap",
      }}>
        <RateBadge label={"閲覧 → CTA\nクリック率"}   rate={funnel.view_to_cta} />
        <RateBadge label={"CTA → 送信\n完了率"}       rate={funnel.cta_to_submit} />
        <RateBadge label={"閲覧 → 送信\n最終転換率"}  rate={funnel.view_to_submit} />
      </div>

      {/* ── イベント一覧カード ── */}
      <div className="card" style={{ padding: "4px 20px 12px" }}>
        {counts.map((c, i) => {
          const icon   = EVENT_ICONS[c.event];
          const color  = barColor(c.count, maxCount);
          const isLast = i === counts.length - 1;

          return (
            <div
              key={c.event}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          12,
                padding:      "13px 0",
                borderBottom: isLast ? "none" : "1px solid #f3f4f6",
              }}
            >
              {/* アイコン */}
              <span style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>
                {icon}
              </span>

              {/* イベント名 */}
              <div style={{ width: 200, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111827)" }}>
                  {c.label}
                </span>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1, fontFamily: "monospace" }}>
                  {c.event}
                </div>
              </div>

              {/* バー */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  height:       8,
                  borderRadius: 99,
                  background:   "#e5e7eb",
                  overflow:     "hidden",
                }}>
                  <div style={{
                    height:       "100%",
                    width:        `${maxCount > 0 ? Math.round((c.count / maxCount) * 100) : 0}%`,
                    borderRadius: 99,
                    background:   color,
                    transition:   "width 0.6s ease",
                  }} />
                </div>
              </div>

              {/* 件数 */}
              <div style={{
                width:      80,
                flexShrink: 0,
                textAlign:  "right",
                fontSize:   13,
              }}>
                <span style={{ fontWeight: 700, color }}>
                  {c.count.toLocaleString()}件
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* フッター */}
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, textAlign: "right" }}>
        ※ 同一ユーザーの複数クリックも件数としてカウントします。
        転換率は小数点以下を四捨五入した概算です。
      </p>
    </>
  );
}
