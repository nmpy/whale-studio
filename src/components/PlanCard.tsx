"use client";

// src/components/PlanCard.tsx
// 現在のプラン・サブスクリプション状態を表示するカード（owner / admin 向け）
//
// データソース: GET /api/oas/:id/subscription
// subscription が未設定（Subscription なし）の場合はスケルトンを表示しない。
// エラー時も非表示（fire-and-forget）。

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDevToken } from "@/lib/api-client";
import { buildPricingUrl } from "@/lib/pricing-url";

// ── 型定義 ──────────────────────────────────────────────────────────────
interface PlanData {
  name:          string;   // "tester" | "editor" | ...
  display_name:  string;
  max_works:     number;   // -1 = 無制限
  max_players:   number;   // -1 = 無制限
  price_monthly: number;
}
interface SubscriptionData {
  status:               string;   // "trialing" | "active" | "canceled" | "past_due"
  current_period_start: string;
  current_period_end:   string;
  canceled_at:          string | null;
}
interface FullPlanInfo {
  plan:         PlanData         | null;
  subscription: SubscriptionData | null;
}

// ── ステータスラベル・スタイル ────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  trialing:  { label: "トライアル中", color: "#92400e", bg: "#fef3c7" },
  active:    { label: "有効",         color: "#166534", bg: "#dcfce7" },
  canceled:  { label: "キャンセル済", color: "#6b7280", bg: "#f3f4f6" },
  past_due:  { label: "支払い遅延",   color: "#991b1b", bg: "#fee2e2" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric",
  });
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary, #111827)" }}>
        {value}
      </div>
    </div>
  );
}

// ── メインコンポーネント ─────────────────────────────────────────────
export function PlanCard({ oaId }: { oaId: string }) {
  const [data,    setData]    = useState<FullPlanInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/oas/${oaId}/subscription`, {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((r) => r.json())
      .then((d) => setData(d.success ? d.data : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [oaId]);

  // ロード中: コンパクトスケルトン
  if (loading) {
    return (
      <div style={{
        padding: "14px 18px", borderRadius: "var(--radius-md, 10px)",
        background: "var(--surface)", border: "1px solid var(--border-light)",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 120, height: 14 }} />
          <div className="skeleton" style={{ width: 72, height: 20, borderRadius: 999 }} />
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {[80, 100, 90].map((w, i) => (
            <div key={i}>
              <div className="skeleton" style={{ width: 44, height: 9, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: w, height: 13 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 未取得 / エラー / Subscription なし → 非表示
  if (!data || !data.plan || !data.subscription) return null;

  const { plan, subscription } = data;

  const isFree       = plan.price_monthly === 0;
  const isLimited    = plan.max_works !== -1;
  const worksLabel   = plan.max_works   === -1 ? "無制限" : `${plan.max_works} 件`;
  const playersLabel = plan.max_players === -1 ? "無制限" : `${plan.max_players} 人`;
  const priceLabel   = isFree ? "無料" : `¥${plan.price_monthly.toLocaleString()}/月`;

  const isPeriodEnd  = subscription.status === "trialing";
  const periodLabel  = isPeriodEnd ? "トライアル終了" : "次回更新";
  const periodDate   = formatDate(subscription.current_period_end);

  const statusMeta   = STATUS_META[subscription.status] ?? {
    label: subscription.status, color: "#6b7280", bg: "#f3f4f6",
  };
  const planIcon     = isFree ? "🔓" : "✅";

  return (
    <div style={{
      padding:      "16px 18px",
      borderRadius: "var(--radius-md, 10px)",
      background:   "var(--surface, #fff)",
      border:       `1px solid ${isFree ? "#b9ddd6" : "#86efac"}`,
      boxShadow:    "var(--shadow-xs)",
      marginBottom: 20,
    }}>
      {/* ── ヘッダー行: アイコン + プラン名 + ステータスバッジ ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
        flexWrap: "wrap",
      }}>
        <span style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 8,
          background: isFree ? "var(--color-primary-soft, #EAF4F1)" : "#f0fdf4",
          fontSize: 16, flexShrink: 0,
        }}>
          {planIcon}
        </span>
        <span style={{
          fontSize: 14, fontWeight: 800,
          color: "var(--text-primary, #111827)",
        }}>
          {plan.display_name}
        </span>
        <span style={{
          display: "inline-flex", alignItems: "center",
          padding: "3px 10px", borderRadius: "var(--radius-full, 999px)",
          fontSize: 11, fontWeight: 700,
          background: statusMeta.bg, color: statusMeta.color,
        }}>
          {statusMeta.label}
        </span>
        <span style={{
          marginLeft: "auto", fontSize: 13, fontWeight: 700,
          color: isFree ? "var(--text-secondary)" : "var(--color-success, #059669)",
        }}>
          {priceLabel}
        </span>
      </div>

      {/* ── 統計行: 作品上限 / プレイヤー上限 / 期限 ── */}
      <div style={{
        display: "flex", gap: 24, flexWrap: "wrap",
        paddingBottom: isLimited ? 14 : 0,
        borderBottom: isLimited ? "1px solid var(--border-light, #f3f4f6)" : "none",
      }}>
        <MetaStat label="作品数上限"       value={worksLabel} />
        <MetaStat label="プレイヤー上限"   value={playersLabel} />
        <MetaStat label={periodLabel}      value={`${periodDate}まで`} />
      </div>

      {/* ── CTA（上限ありプランのみ） ── */}
      {isLimited && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: 12, gap: 8, flexWrap: "wrap",
        }}>
          <p style={{
            fontSize: 12, color: "var(--text-secondary, #6b7280)",
            margin: 0, lineHeight: 1.5,
          }}>
            作品を追加・機能を拡張するには上位プランへのアップグレードが必要です。
          </p>
          <Link
            href={buildPricingUrl({ source: "settings", from: plan.name, to: "editor", oaId })}
            style={{
              display:        "inline-flex",
              alignItems:     "center",
              gap:            4,
              padding:        "6px 14px",
              borderRadius:   "var(--radius-full, 999px)",
              background:     "var(--color-primary, #2F6F5E)",
              color:          "#fff",
              fontSize:       12,
              fontWeight:     700,
              textDecoration: "none",
              whiteSpace:     "nowrap",
              flexShrink:     0,
            }}
          >
            プランを見る →
          </Link>
        </div>
      )}
    </div>
  );
}
