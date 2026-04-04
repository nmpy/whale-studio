"use client";

// src/app/oas/[id]/onboarding-analytics/page.tsx
// オンボーディング分析ダッシュボード — owner 専用

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getDevToken } from "@/lib/api-client";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";

// ── 型定義 ────────────────────────────────────────────────────
interface FunnelStep {
  step:               string;
  label:              string;
  desc:               string;
  count:              number;
  rate:               number;  // %（例: 80.0）
  dropoff_from_prev:  number;  // %
}

interface AnalyticsData {
  oa_id:       string;
  total_works: number;
  funnel:      FunnelStep[];
}

// ── ステップ絵文字 ───────────────────────────────────────────────
const STEP_ICONS: Record<string, string> = {
  work_created:      "📝",
  character_created: "👤",
  phase_created:     "🗂",
  message_created:   "💬",
  flow_connected:    "🔀",
  previewed:         "▶️",
};

// ── カラー (rate に応じた帯色) ─────────────────────────────────────
function rateColor(rate: number): string {
  if (rate >= 70) return "#16a34a"; // green
  if (rate >= 40) return "#d97706"; // amber
  return "#dc2626";                  // red
}

export default function OnboardingAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { isOwner, loading: roleLoading } = useWorkspaceRole(oaId);

  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (roleLoading) return;
    if (!isOwner) {
      router.replace(`/oas/${oaId}/settings`);
      return;
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading, isOwner]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/oas/${oaId}/onboarding-analytics`, {
        headers: { Authorization: `Bearer ${getDevToken()}` },
      });
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

  // ── ローディング中 ──────────────────────────────────────────────
  if (roleLoading || (loading && !data)) {
    return (
      <>
        <div className="page-header">
          <div>
            <Breadcrumb items={[
              { label: "アカウントリスト", href: "/oas" },
              { label: "設定",            href: `/oas/${oaId}/settings` },
              { label: "オンボーディング分析" },
            ]} />
            <h2>オンボーディング分析</h2>
          </div>
        </div>
        <div className="card">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 120, height: 14, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: "100%", height: 8, borderRadius: 4 }} />
              </div>
              <div className="skeleton" style={{ width: 60, height: 20 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── エラー ──────────────────────────────────────────────────────
  if (error) {
    return (
      <>
        <div className="page-header">
          <h2>オンボーディング分析</h2>
        </div>
        <div className="alert alert-error">
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      </>
    );
  }

  if (!data) return null;

  const { total_works, funnel } = data;
  const completionStep = funnel[funnel.length - 1];

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定",            href: `/oas/${oaId}/settings` },
            { label: "オンボーディング分析" },
          ]} />
          <h2>オンボーディング分析</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            作品作成から初回セットアップ完了までの各ステップ到達率（owner のみ閲覧可）
          </p>
        </div>
        <button
          onClick={load}
          className="btn btn-ghost"
          disabled={loading}
        >
          {loading ? <span className="spinner" /> : "↻"} 更新
        </button>
      </div>

      {/* ── サマリーカード ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 12,
        marginBottom: 24,
      }}>
        {[
          {
            label: "対象作品数",
            value: total_works,
            icon:  "📦",
            color: "var(--text-primary)",
            bg:    "#f9fafb",
          },
          {
            label: "最終完了率",
            value: `${completionStep.rate}%`,
            icon:  "🏁",
            color: rateColor(completionStep.rate),
            bg:    "#f0fdf4",
          },
          {
            label: "最大離脱ステップ",
            value: (() => {
              const maxDrop = funnel.slice(1).reduce((a, b) =>
                b.dropoff_from_prev > a.dropoff_from_prev ? b : a
              );
              return maxDrop.dropoff_from_prev > 0 ? maxDrop.label : "—";
            })(),
            icon:  "⚠️",
            color: "#dc2626",
            bg:    "#fef2f2",
          },
        ].map((s) => (
          <div key={s.label} style={{
            background: s.bg,
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "14px 18px",
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── ファネルテーブル ── */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>セットアップファネル</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>
            ※ 作品数0の場合は分析できません。到達率はステップ完了作品数 ÷ 総作品数で算出します。
          </p>
        </div>

        {total_works === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
            <p style={{ fontSize: 14 }}>まだ作品が作成されていません。</p>
          </div>
        ) : (
          <div>
            {funnel.map((step, i) => (
              <div
                key={step.step}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 20px",
                  borderBottom: i < funnel.length - 1 ? "1px solid #f3f4f6" : "none",
                }}
              >
                {/* ステップ番号 + アイコン */}
                <div style={{
                  width: 36, height: 36,
                  borderRadius: 8,
                  background: "#f3f4f6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, flexShrink: 0,
                }}>
                  {STEP_ICONS[step.step] ?? "○"}
                </div>

                {/* ラベル + バー */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {i + 1}. {step.label}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>
                      {step.count} 作品
                    </span>
                  </div>

                  {/* プログレスバー */}
                  <div style={{
                    height: 8,
                    borderRadius: 4,
                    background: "#e5e7eb",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${step.rate}%`,
                      borderRadius: 4,
                      background: rateColor(step.rate),
                      transition: "width 0.6s ease",
                    }} />
                  </div>

                  {/* ドロップオフ表示 */}
                  {i > 0 && step.dropoff_from_prev > 0 && (
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>
                      ↓ 前ステップから {step.dropoff_from_prev}% 離脱
                    </div>
                  )}
                </div>

                {/* 到達率バッジ */}
                <div style={{
                  flexShrink: 0,
                  minWidth: 56,
                  textAlign: "right",
                  fontSize: 16,
                  fontWeight: 800,
                  color: rateColor(step.rate),
                }}>
                  {step.rate}%
                </div>
              </div>
            ))}
          </div>
        )}

        {/* フッター */}
        {total_works > 0 && (
          <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-light)", fontSize: 11, color: "var(--text-muted)" }}>
            対象: {total_works} 作品 ／ 「プレビュー確認」はブラウザ上での実行を記録（初回のみ）
          </div>
        )}
      </div>
    </>
  );
}
