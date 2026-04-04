"use client";

// src/components/upgrade/TesterUpgradeCard.tsx
// テスター上限到達時のアップグレード誘導カード。
// variant:
//   "banner"  — 作品リスト上部の横長バナー（works > page.tsx）
//   "gate"    — 新規作成フォームの代わりに表示するフルブロック（works/new > page.tsx）
//   "preview" — プレビュー後のソフト誘導（作品ハブ > [workId]/page.tsx）

import { useEffect } from "react";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { trackEvent } from "@/lib/event-tracker";
import { getDevToken } from "@/lib/api-client";
import type { BillingEvent } from "@/lib/constants/billing-events";
import { useIsMobile } from "@/hooks/useIsMobile";

interface TesterUpgradeCardProps {
  variant: "banner" | "gate" | "preview";
  /** "preview" variant を非表示にするコールバック */
  onDismiss?: () => void;
  /** 作品リストに戻るリンク用 oaId（"gate" variant で使用） */
  oaId?: string;
}

// ── BillingEvent → URL source ラベル変換 ─────────────────────────────
// pricing_click_from_banner → "banner"（?source= に使う短縮形）
const EVENT_TO_SOURCE: Partial<Record<BillingEvent, string>> = {
  pricing_click_from_header:  "header",
  pricing_click_from_banner:  "banner",
  pricing_click_from_gate:    "gate",
  pricing_click_from_preview: "preview",
};

// ── 共用: プランを見るリンク ──────────────────────────────────────────
function PricingLink({ source, style }: { source: BillingEvent; style?: React.CSSProperties }) {
  const urlSource = EVENT_TO_SOURCE[source];
  const href      = urlSource ? `/pricing?source=${urlSource}` : "/pricing";

  return (
    <a
      href={href}
      onClick={() => trackBillingEvent(source, getDevToken(), urlSource)}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            3,
        fontSize:       12,
        fontWeight:     700,
        color:          "var(--color-primary, #2F6F5E)",
        textDecoration: "none",
        whiteSpace:     "nowrap",
        flexShrink:     0,
        ...style,
      }}
    >
      プランを見る →
    </a>
  );
}

export function TesterUpgradeCard({ variant, onDismiss, oaId }: TesterUpgradeCardProps) {
  const sp = useIsMobile();

  // バナー/ゲートの表示を upgrade_interest として記録（mount 時1回）
  useEffect(() => {
    if (variant === "banner") {
      trackEvent("upgrade_interest", { action: "banner_shown", source: "banner" }, { token: getDevToken() });
    }
    // gate は works/new/page.tsx 側で記録するため、ここでは banner のみ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── バナー ──────────────────────────────────────────────────────────
  if (variant === "banner") {
    return (
      <div style={{
        display:        "flex",
        alignItems:     sp ? "flex-start" : "center",
        flexDirection:  sp ? "column" : "row",
        gap:            sp ? 8 : 12,
        padding:        sp ? "12px 14px" : "12px 16px",
        background:     "var(--color-primary-soft, #EAF4F1)",
        border:         "1px solid #b9ddd6",
        borderRadius:   "var(--radius-md, 10px)",
        marginBottom:   16,
        fontSize:       13,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>🔓</span>
          <div>
            <div style={{ fontWeight: 700, color: "var(--color-primary, #2F6F5E)", marginBottom: 2 }}>
              テスタープランの作品数上限（1 件）に達しています
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              追加で作品を作成するには、editorプランへのアップグレードが必要です。
            </div>
          </div>
        </div>
        <PricingLink source="pricing_click_from_banner" style={{
          alignSelf:      sp ? "stretch" : "auto",
          justifyContent: sp ? "center" : "flex-start",
          padding:        sp ? "10px 12px" : "5px 12px",
          borderRadius:   "var(--radius-full, 999px)",
          background:     "var(--color-primary, #2F6F5E)",
          color:          "#fff",
          fontSize:       sp ? 13 : 11,
        }} />
      </div>
    );
  }

  // ── ゲート ──────────────────────────────────────────────────────────
  if (variant === "gate") {
    return (
      <div style={{
        maxWidth:     560,
        // SP: 水平パディングを縮小し、縦スペースを確保
        padding:      sp ? "28px 18px 24px" : "36px 32px",
        background:   "var(--surface, #fff)",
        border:       "1px solid var(--border-light, #e5e7eb)",
        borderRadius: "var(--radius-md, 10px)",
        boxShadow:    "var(--shadow-sm)",
        textAlign:    "center",
      }}>
        <div style={{ fontSize: sp ? 36 : 44, marginBottom: 14, lineHeight: 1 }}>🔓</div>
        <h3 style={{ margin: "0 0 8px", fontSize: sp ? 15 : 16, fontWeight: 800, color: "var(--text-primary, #111827)" }}>
          作品の作成上限に達しています
        </h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)", marginBottom: 22, lineHeight: 1.7 }}>
          テスタープランでは作品を <strong>1 件まで</strong> しか作成できません。<br />
          さらに作品を追加するには <strong>editor プラン</strong> が必要です。
        </p>

        {/* プランを見るCTA — フル幅 */}
        <a
          href="/pricing?source=gate"
          onClick={() => trackBillingEvent("pricing_click_from_gate", getDevToken(), "gate")}
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            width:          "100%",
            padding:        sp ? "13px 20px" : "12px 20px",
            borderRadius:   "var(--radius-sm, 8px)",
            background:     "var(--color-primary, #2F6F5E)",
            color:          "#fff",
            fontSize:       14,
            fontWeight:     700,
            textDecoration: "none",
            marginBottom:   10,
            boxSizing:      "border-box",
          }}
        >
          プランを見る →
        </a>

        {oaId && (
          <a
            href={`/oas/${oaId}/works`}
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            4,
              padding:        sp ? "11px 18px" : "8px 18px",
              borderRadius:   "var(--radius-sm, 6px)",
              background:     "var(--surface, #fff)",
              border:         "1px solid var(--border-light, #e5e7eb)",
              fontSize:       13,
              color:          "var(--text-secondary, #6b7280)",
              textDecoration: "none",
              width:          "100%",
              boxSizing:      "border-box",
            }}
          >
            ← 作品リストに戻る
          </a>
        )}
      </div>
    );
  }

  // ── プレビュー後ソフト誘導 ──────────────────────────────────────────
  return (
    <div style={{
      padding:      sp ? "12px 14px" : "14px 18px",
      background:   "var(--color-primary-soft, #EAF4F1)",
      border:       "1px solid #b9ddd6",
      borderRadius: "var(--radius-md, 10px)",
      marginBottom: 16,
      fontSize:     13,
    }}>
      {/* 上段: アイコン + テキスト + 閉じるボタン */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>🎉</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--color-primary, #2F6F5E)", marginBottom: 3 }}>
            プレビューをご確認いただけましたか？
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            テスタープランでは作品を 1 件まで作成できます。さらに作品を制作するには
            <strong> editor プラン</strong>へのアップグレードが必要です。
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: "none",
              border:     "none",
              cursor:     "pointer",
              color:      "var(--text-muted)",
              fontSize:   18,
              lineHeight: 1,
              padding:    "2px 4px",
              flexShrink: 0,
            }}
            title="閉じる"
          >
            ×
          </button>
        )}
      </div>

      {/* SP: プランリンクを下段にフル幅で表示 */}
      <div style={{ marginTop: 10, paddingLeft: 30 }}>
        <PricingLink
          source="pricing_click_from_preview"
          style={sp ? {
            display:        "flex",
            justifyContent: "center",
            padding:        "9px 12px",
            background:     "var(--color-primary, #2F6F5E)",
            color:          "#fff",
            borderRadius:   "var(--radius-sm, 8px)",
            fontSize:       13,
          } : {}}
        />
      </div>
    </div>
  );
}
