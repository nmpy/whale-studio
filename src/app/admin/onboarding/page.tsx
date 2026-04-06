"use client";

// src/app/admin/onboarding/page.tsx
// オンボーディング進捗分析（プラットフォームオーナー専用）
// admin layout の isPlatformOwner チェックにより、非オーナーはここに到達できない。

import { useEffect, useState } from "react";
import { getDevToken } from "@/lib/api-client";
import { ONBOARDING_STEPS, ONBOARDING_STEP_LABELS } from "@/lib/constants/onboarding";

// ── 型 ────────────────────────────────────────────────────────────────────

interface StepData {
  step:  string;
  count: number;
  rate:  number; // 0〜100 の整数
}

interface OnboardingAnalytics {
  total_started: number;
  steps:         StepData[];
}

// ── 定数 ──────────────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, string> = {
  work_created:      "",
  character_created: "",
  phase_created:     "",
  message_created:   "",
  flow_connected:    "",
  previewed:         "",
};

// ── ヘルパー ──────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization:  `Bearer ${getDevToken()}`,
  };
}

/** rate に応じたバーの塗り色 */
function barColor(rate: number): string {
  if (rate >= 70) return "#2F6F5E"; // primary green
  if (rate >= 40) return "#d97706"; // amber
  return "#dc2626";                  // red
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
      <div className="skeleton" style={{ width: 120, height: 14 }} />
      <div className="skeleton" style={{ flex: 1, height: 8, borderRadius: 99 }} />
      <div className="skeleton" style={{ width: 80, height: 14 }} />
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────────────────────────

export default function AdminOnboardingPage() {
  const [data,    setData]    = useState<OnboardingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/onboarding", { headers: authHeaders() });
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
        <h2 style={{ margin: 0 }}>オンボーディング進捗</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          初回ユーザーがどこまで設定を進めたかを確認できます
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
            {ONBOARDING_STEPS.map((s) => <SkeletonRow key={s} />)}
          </div>
        </div>
      </>
    );
  }

  if (!data) return null;

  const { total_started, steps } = data;

  // ONBOARDING_STEPS の順序を保持しつつ、未返却ステップは 0 補完
  const stepMap = new Map(steps.map((s) => [s.step, s]));
  const orderedSteps: StepData[] = ONBOARDING_STEPS.map((key) =>
    stepMap.get(key) ?? { step: key, count: 0, rate: 0 }
  );

  // ── 最大離脱ポイントを計算（インデックス1以降＝前ステップとの差が最大の箇所）
  type DropoffEntry = { fromLabel: string; toLabel: string; dropoff: number };
  const maxDropoff: DropoffEntry | null = (() => {
    if (total_started === 0) return null;
    let best: DropoffEntry | null = null;
    for (let i = 1; i < orderedSteps.length; i++) {
      const prev    = orderedSteps[i - 1];
      const curr    = orderedSteps[i];
      const pct     = prev.count > 0
        ? Math.round(((prev.count - curr.count) / prev.count) * 100)
        : 0;
      if (pct > 0 && (best === null || pct > best.dropoff)) {
        best = {
          fromLabel: ONBOARDING_STEP_LABELS[prev.step as keyof typeof ONBOARDING_STEP_LABELS] ?? prev.step,
          toLabel:   ONBOARDING_STEP_LABELS[curr.step as keyof typeof ONBOARDING_STEP_LABELS] ?? curr.step,
          dropoff:   pct,
        };
      }
    }
    return best;
  })();

  return (
    <>
      {header}

      {/* ── サマリーバッジ ── */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        marginBottom: 16,
        padding:      "10px 16px",
        background:   "#f0fdf4",
        border:       "1px solid #bbf7d0",
        borderRadius: "var(--radius-md, 10px)",
        fontSize:     13,
      }}>
        <span style={{ fontSize: 16 }}>🚀</span>
        <span style={{ color: "#166534" }}>
          <strong>{total_started.toLocaleString()} 件</strong> の作品作成を起点として集計しています
        </span>
        {total_started === 0 && (
          <span style={{ color: "#6b7280", marginLeft: 4 }}>
            （まだデータがありません）
          </span>
        )}
      </div>

      {/* ── 最大離脱ポイント ── */}
      {maxDropoff && (
        <div style={{
          display:      "flex",
          alignItems:   "center",
          gap:          10,
          marginBottom: 16,
          padding:      "10px 16px",
          background:   "#fff7ed",
          border:       "1px solid #fed7aa",
          borderRadius: "var(--radius-md, 10px)",
          fontSize:     13,
        }}>
          <div>
            <span style={{ fontWeight: 700, color: "#92400e" }}>最大離脱ポイント</span>
            <span style={{ color: "#78350f", marginLeft: 8 }}>
              {maxDropoff.fromLabel}
              <span style={{ margin: "0 6px", color: "#d97706" }}>→</span>
              {maxDropoff.toLabel}
            </span>
            <span style={{
              marginLeft:   8,
              padding:      "1px 8px",
              borderRadius: 99,
              background:   "#fef3c7",
              color:        "#92400e",
              fontWeight:   700,
              fontSize:     12,
            }}>
              {maxDropoff.dropoff}% 離脱
            </span>
          </div>
        </div>
      )}

      {/* ── ファネルカード ── */}
      <div className="card" style={{ padding: "4px 20px 12px" }}>
        {orderedSteps.map((s, i) => {
          const label = ONBOARDING_STEP_LABELS[s.step as keyof typeof ONBOARDING_STEP_LABELS] ?? s.step;
          const icon  = STEP_ICONS[s.step] ?? "○";
          const color = barColor(s.rate);
          const isLast = i === orderedSteps.length - 1;

          // 前ステップからのドロップオフ
          const prevCount = i === 0 ? total_started : (orderedSteps[i - 1]?.count ?? total_started);
          const dropoff   = prevCount > 0 && i > 0
            ? Math.round(((prevCount - s.count) / prevCount) * 100)
            : null;

          return (
            <div
              key={s.step}
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

              {/* ステップ名 */}
              <div style={{ width: 148, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111827)" }}>
                  {i + 1}. {label}
                </span>
                {dropoff !== null && dropoff > 0 && (
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                    ↓ 前から {dropoff}% 離脱
                  </div>
                )}
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
                    height:     "100%",
                    width:      `${s.rate}%`,
                    borderRadius: 99,
                    background: color,
                    transition: "width 0.6s ease",
                  }} />
                </div>
              </div>

              {/* 数値 */}
              <div style={{
                width:      100,
                flexShrink: 0,
                textAlign:  "right",
                fontSize:   13,
              }}>
                <span style={{ fontWeight: 700, color }}>
                  {s.count.toLocaleString()}人
                </span>
                <span style={{ color: "#9ca3af", marginLeft: 4 }}>
                  / {s.rate}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* フッター補足 */}
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, textAlign: "right" }}>
        ※ 同一ユーザーが複数作品を作成した場合は作品ごとにカウントします。
        「プレビュー確認」はブラウザ上での操作を記録します。
      </p>
    </>
  );
}
