"use client";

// src/app/pricing/_content.tsx
// プランページのクライアントコンポーネント本体。
// page.tsx（Server Component）が searchParams を受け取り、props として渡す。
// useSearchParams() 依存なし。
//
// Props:
//   source — 流入元 UI（"header" | "banner" | "gate" | "preview" | "settings"）
//   from   — 現在プラン名（"tester" など）
//   to     — アップグレード先プラン名（"editor" など）

import { useState, useEffect } from "react";
import Link from "next/link";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { trackEvent } from "@/lib/event-tracker";
import { getDevToken } from "@/lib/api-client";
import { useIsMobile } from "@/hooks/useIsMobile";

// ── チェックアイテム ─────────────────────────────────────────────────
function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display:    "flex",
      alignItems: "flex-start",
      gap:        10,
      fontSize:   13,
      color:      "var(--text-secondary)",
      lineHeight: 1.6,
    }}>
      <span style={{
        flexShrink:     0,
        marginTop:      2,
        width:          18,
        height:         18,
        borderRadius:   "50%",
        background:     "var(--color-primary-soft, #EAF4F1)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        fontSize:       10,
        color:          "var(--color-primary, #2F6F5E)",
        fontWeight:     700,
      }} />
      <span>{children}</span>
    </div>
  );
}

// ── セクション見出し ─────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize:      11,
      fontWeight:    700,
      letterSpacing: "0.07em",
      textTransform: "uppercase",
      color:         "var(--text-muted)",
      marginBottom:  10,
    }}>
      {children}
    </p>
  );
}

// ── コンテキスト設定 ─────────────────────────────────────────────────

/** source ごとのヘッダー見出し・サブテキスト */
const SOURCE_HEADING: Record<string, { title: string; sub: string }> = {
  gate: {
    title: "もう1作品、作れるようにしませんか？",
    sub:   "現在のプランでは作品をこれ以上追加できません。上位プランにアップグレードして、制作を続けましょう。",
  },
  banner: {
    title: "作品数の上限に近づいています",
    sub:   "今のうちにプランをアップグレードしておくと、スムーズに制作を続けられます。",
  },
  preview: {
    title: "プレビューはいかがでしたか？",
    sub:   "動作を確認できたら、次は本番公開のステップです。上位プランで続けましょう。",
  },
  settings: {
    title: "プランの変更を検討していますか？",
    sub:   "現在のご利用状況と比較しながら、ご自身のペースでご検討ください。",
  },
};
const DEFAULT_HEADING = {
  title: "小さくはじめて、必要なときに広げる。",
  sub:   "Whale Studio は、今すぐ全部決めなくていいツールです。\nお試し利用から本格運用まで、ペースに合わせてステップアップできます。",
};

/** from プランごとの「いまのご利用状況」表示設定 */
const FROM_PLAN_CONFIG: Record<string, {
  badge:       string;
  badgeBg:     string;
  badgeColor:  string;
  badgeBorder: string;
  features:    string[];
  footer:      string;
}> = {
  tester: {
    badge:       "tester プラン",
    badgeBg:     "#fef3c7",
    badgeColor:  "#92400e",
    badgeBorder: "#fde68a",
    features: [
      "1 作品をじっくり試作できる",
      "キャラクター・メッセージ・フローをひと通り体験",
      "プレビューで動作確認",
    ],
    footer: "まずはここからスタート。制作の感触をつかんでから、次のステップを検討できます。",
  },
  // 将来のプランをここに追加
};

/** to プランごとのアップグレード先表示設定 */
const TO_PLAN_CONFIG: Record<string, {
  sectionLabel: string;
  planName:     string;
  price:        string;
  priceUnit:    string;
  ctaText:      string;
  features:     string[];
  footer:       string;
}> = {
  editor: {
    sectionLabel: "editor プランに移ると",
    planName:     "editor プラン",
    price:        "¥9,800",
    priceUnit:    "/ 月",
    ctaText:      "editorプランについて相談する",
    features: [
      "複数の作品を並行して制作・管理できる",
      "制作した作品をそのまま本番公開できる",
      "継続的に改善・運用を続けられる",
    ],
    footer: "現在の作品・キャラクター・フローはそのまま引き継がれます。",
  },
  // 将来のプランをここに追加
};

// ── クライアントコンポーネント本体 ────────────────────────────────────
// props は page.tsx（Server Component）が searchParams から渡す
export function PricingContent({
  source,
  from:     fromParam,
  to:       toParam,
  oaId,
  canceled,
}: {
  source?:   string;
  from?:     string;
  to?:       string;
  /** Stripe Checkout の申込先 OA ID（あれば Stripe ボタンを有効化） */
  oaId?:     string;
  /** "1" のとき Stripe Checkout からのキャンセル戻りを示すバナーを表示 */
  canceled?: string;
}) {
  const sp = useIsMobile();
  const [requested,       setRequested]       = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError,   setCheckoutError]   = useState<string | null>(null);

  // コンテキストに応じた表示設定を導出
  const heading  = (source ? SOURCE_HEADING[source] : null) ?? DEFAULT_HEADING;
  const fromPlan = (fromParam ? FROM_PLAN_CONFIG[fromParam] : null) ?? FROM_PLAN_CONFIG.tester;
  const toPlan   = (toParam   ? TO_PLAN_CONFIG[toParam]     : null) ?? TO_PLAN_CONFIG.editor;

  useEffect(() => {
    const token = getDevToken();

    // 課金専用ログ（from/to コンテキスト付き）
    trackBillingEvent("pricing_view", token, source, { from: fromParam, to: toParam });

    // 汎用行動ログ（event_logs）— payload に from/to も含める
    trackEvent("screen_view",      { page: "/pricing" },                                       { token });
    trackEvent("upgrade_interest", { action: "view", source, from: fromParam, to: toParam },   { token });
    trackEvent("flow_step",        { step: "pricing", source: source ?? "direct" },            { token });
  // searchParams は mount 時に1回だけ読めば十分
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUpgrade() {
    const token = getDevToken();
    trackBillingEvent("pricing_cta_click", token, source, { from: fromParam, to: toParam });
    trackEvent("upgrade_interest", { action: "cta_click", source, from: fromParam, to: toParam }, { token });
    window.dispatchEvent(
      new CustomEvent("open-feedback-modal", {
        detail: { pricingSource: source },
      })
    );
    setRequested(true);
  }

  async function handleStripeCheckout() {
    if (!oaId) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const token = getDevToken();
      const res   = await fetch("/api/billing/checkout-session", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ oaId, source, fromPlan: fromParam }),
      });
      const data = await res.json();
      if (!res.ok || !data.data?.url) {
        setCheckoutError(data.error ?? "チェックアウトセッションの作成に失敗しました");
        return;
      }
      trackBillingEvent("pricing_cta_click", token, source, { from: fromParam, to: toParam });
      trackEvent("upgrade_interest", { action: "stripe_checkout_start", source, from: fromParam, to: toParam }, { token });
      window.location.href = data.data.url;
    } catch {
      setCheckoutError("エラーが発生しました。もう一度お試しください。");
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <div style={{
      maxWidth: 600,
      margin:   "0 auto",
      padding:  sp ? "20px 0 48px" : "40px 0 64px",
    }}>

      {/* ── ヘッダー（source ごとに見出し・サブを出し分け） ── */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{
          display:        "inline-flex",
          alignItems:     "center",
          gap:            6,
          padding:        "4px 14px",
          borderRadius:   "var(--radius-full)",
          background:     "var(--color-primary-soft, #EAF4F1)",
          border:         "1px solid #b9ddd6",
          fontSize:       11,
          fontWeight:     700,
          color:          "var(--color-primary, #2F6F5E)",
          letterSpacing:  "0.05em",
          marginBottom:   16,
        }}>
          🐋 WHALE STUDIO プラン
        </div>
        <h1 style={{
          fontSize:      "clamp(20px, 4vw, 26px)",
          fontWeight:    800,
          color:         "var(--text-primary)",
          letterSpacing: "-0.02em",
          lineHeight:    1.3,
          marginBottom:  10,
        }}>
          {heading.title}
        </h1>
        <p style={{
          fontSize:   13,
          color:      "var(--text-secondary)",
          lineHeight: 1.8,
          whiteSpace: "pre-line",
        }}>
          {heading.sub}
        </p>
      </div>

      {/* ── コンセプト 3 点（source=default 以外は簡略表示） ── */}
      {!source && (
        <div style={{
          display:       "flex",
          gap:           sp ? 6 : 8,
          marginBottom:  sp ? 20 : 28,
          flexDirection: sp ? "column" : "row",
          flexWrap:      "wrap",
        }}>
          {[
            { icon: "🌱", text: "まず1作品、気軽に試せる" },
            { text: "無理に決めなくていい" },
            { text: "成長に合わせてプラン変更できる" },
          ].map(({ icon, text }) => (
            <div key={text} style={{
              flex:         sp ? "none" : "1 1 140px",
              display:      "flex",
              alignItems:   "center",
              gap:          8,
              padding:      sp ? "9px 12px" : "10px 14px",
              background:   "var(--surface)",
              border:       "1px solid var(--border-light)",
              borderRadius: "var(--radius-md)",
              fontSize:     12,
              color:        "var(--text-secondary)",
            }}>
              {icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>}
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 現在のご利用状況（from パラメータで動的出し分け） ── */}
      <div className="card" style={{ marginBottom: 12, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <SectionLabel>いまのご利用状況</SectionLabel>
          <span style={{
            padding:      "2px 10px",
            borderRadius: "var(--radius-full)",
            fontSize:     11,
            fontWeight:   700,
            background:   fromPlan.badgeBg,
            color:        fromPlan.badgeColor,
            border:       `1px solid ${fromPlan.badgeBorder}`,
          }}>
            {fromPlan.badge}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {fromPlan.features.map((f) => <CheckItem key={f}>{f}</CheckItem>)}
        </div>
        <p style={{
          marginTop:  14,
          fontSize:   12,
          color:      "var(--text-muted)",
          lineHeight: 1.6,
          paddingTop: 12,
          borderTop:  "1px solid var(--border-light)",
        }}>
          {fromPlan.footer}
        </p>
      </div>

      {/* ── アップグレード先でできること（to パラメータで動的出し分け） ── */}
      <div style={{
        padding:      "20px 24px",
        marginBottom: 28,
        background:   "var(--color-primary-soft, #EAF4F1)",
        border:       "1px solid #b9ddd6",
        borderRadius: "var(--radius-md)",
      }}>
        <SectionLabel>{toPlan.sectionLabel}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {toPlan.features.map((f) => <CheckItem key={f}>{f}</CheckItem>)}
        </div>
        <p style={{
          marginTop:  12,
          fontSize:   12,
          color:      "#2d5a4e",
          lineHeight: 1.6,
          paddingTop: 10,
          borderTop:  "1px solid #b9ddd6",
        }}>
          {toPlan.footer}
        </p>
      </div>

      {/* ── プランカード（to パラメータで価格・名前を出し分け） ── */}
      <div style={{
        background:   "var(--surface)",
        border:       "2px solid var(--color-primary, #2F6F5E)",
        borderRadius: "var(--radius-lg)",
        padding:      sp ? "24px 18px" : "32px 28px",
        textAlign:    "center",
        boxShadow:    "var(--shadow-md)",
        marginBottom: 28,
        position:     "relative",
        overflow:     "hidden",
      }}>
        {/* アクセントライン */}
        <div style={{
          position:   "absolute",
          top:        0, left: 0, right: 0,
          height:     4,
          background: "var(--color-primary, #2F6F5E)",
        }} />

        <p style={{
          fontSize:      11,
          fontWeight:    700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color:         "var(--color-primary, #2F6F5E)",
          marginBottom:  8,
        }}>
          本格運用へのステップ
        </p>

        <h3 style={{
          fontSize:      20,
          fontWeight:    800,
          color:         "var(--text-primary)",
          letterSpacing: "-0.02em",
          marginBottom:  10,
        }}>
          {toPlan.planName}
        </h3>

        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: sp ? 28 : 34, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>
            {toPlan.price}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 4 }}>
            {toPlan.priceUnit}
          </span>
        </div>

        <p style={{
          fontSize:     13,
          color:        "var(--text-secondary)",
          lineHeight:   1.7,
          marginBottom: 20,
        }}>
          複数作品の制作・公開・改善を、自分のペースで続けられます。
        </p>

        <div style={{
          display:       "flex",
          flexDirection: "column",
          gap:           8,
          marginBottom:  20,
          padding:       "16px 20px",
          background:    "var(--bg)",
          borderRadius:  "var(--radius-sm)",
          textAlign:     "left",
        }}>
          {toPlan.features.map((f) => <CheckItem key={f}>{f}</CheckItem>)}
        </div>

        {/* キャンセル戻りバナー（Stripe Checkout キャンセル時） */}
        {canceled === "1" && (
          <div style={{
            padding:      "10px 14px",
            borderRadius: "var(--radius-sm)",
            background:   "#fffbeb",
            border:       "1px solid #fde68a",
            fontSize:     12,
            color:        "#b45309",
            lineHeight:   1.6,
            marginBottom: 14,
          }}>
            ⚠ お申し込みをキャンセルしました。ご検討中の場合はお気軽にご相談ください。
          </div>
        )}

        {/* Stripe エラー */}
        {checkoutError && (
          <div style={{
            padding:      "10px 14px",
            borderRadius: "var(--radius-sm)",
            background:   "#fee2e2",
            border:       "1px solid #fca5a5",
            fontSize:     12,
            color:        "#991b1b",
            lineHeight:   1.6,
            marginBottom: 10,
          }}>
            {checkoutError}
          </div>
        )}

        {/* Primary CTA — Stripe で申し込む（oaId があるときのみ表示） */}
        {oaId && (
          <button
            onClick={handleStripeCheckout}
            disabled={checkoutLoading}
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            6,
              width:          "100%",
              padding:        "13px 20px",
              borderRadius:   "var(--radius-sm)",
              background:     checkoutLoading ? "var(--color-primary-soft, #EAF4F1)" : "var(--color-primary, #2F6F5E)",
              color:          checkoutLoading ? "var(--color-primary, #2F6F5E)" : "#fff",
              fontSize:       14,
              fontWeight:     700,
              border:         "none",
              cursor:         checkoutLoading ? "not-allowed" : "pointer",
              marginBottom:   10,
              transition:     "background 0.15s",
              boxSizing:      "border-box",
            }}
          >
            {checkoutLoading ? (
              <>
                <span style={{
                  display:      "inline-block",
                  width:        14,
                  height:       14,
                  border:       "2px solid var(--color-primary, #2F6F5E)",
                  borderTop:    "2px solid transparent",
                  borderRadius: "50%",
                  animation:    "spin 0.8s linear infinite",
                }} />
                処理中...
              </>
            ) : (
              <>💳 Stripe で申し込む</>
            )}
          </button>
        )}

        {/* Secondary CTA — 相談する */}
        <p style={{
          fontSize:     12,
          color:        "var(--text-muted)",
          lineHeight:   1.6,
          marginBottom: 10,
          textAlign:    "center",
        }}>
          {oaId ? "まだ検討中の場合は、" : "まずは、"}お気軽にご相談ください。
        </p>

        {requested ? (
          <div style={{
            padding:      "12px",
            borderRadius: "var(--radius-sm)",
            background:   "var(--color-primary-soft, #EAF4F1)",
            border:       "1px solid #b9ddd6",
            fontSize:     13,
            color:        "var(--color-primary, #2F6F5E)",
            fontWeight:   600,
            marginBottom: 8,
          }}>
            ご相談フォームを開きました。内容を送信してください。
          </div>
        ) : (
          <button
            onClick={handleUpgrade}
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              width:          "100%",
              padding:        "11px 20px",
              borderRadius:   "var(--radius-sm)",
              background:     "var(--surface)",
              border:         "1px solid var(--border-default, #d1d5db)",
              color:          "var(--text-secondary)",
              fontSize:       13,
              fontWeight:     600,
              cursor:         "pointer",
              boxSizing:      "border-box",
            }}
          >
            {toPlan.ctaText}
          </button>
        )}

        <Link
          href="/oas"
          style={{
            display:   "block",
            marginTop: 12,
            fontSize:  13,
            color:     "var(--text-muted)",
          }}
        >
          もう少し試してみる
        </Link>
      </div>

      {/* ── 安心ブロック ── */}
      <div style={{
        padding:      sp ? "18px 16px" : "24px",
        background:   "var(--surface)",
        border:       "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
      }}>
        <p style={{
          fontSize:      12,
          fontWeight:    700,
          color:         "var(--text-muted)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          marginBottom:  16,
          textAlign:     "center",
        }}>
          ご相談前に知っておいてほしいこと
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            {
              icon:  "🤝",
              title: "無理な営業はしません",
              body:  "ご相談いただいた内容をもとに、個別にご案内します。その場でのお申し込みを求めることはありません。",
            },
            {
              icon:  "🐣",
              title: "現在はβ版です",
              body:  "Whale Studio はまだ成長中のサービスです。一緒に育てていただけるユーザーさんを大切にしています。",
            },
            {
              icon:  "",
              title: "個別サポートがあります",
              body:  "はじめての導入や使い方の相談など、担当が個別にサポートします。一人で抱え込まなくて大丈夫です。",
            },
          ].map(({ icon, title, body }) => (
            <div key={title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1, width: 28, textAlign: "center" }}>
                {icon}
              </span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>
                  {title}
                </p>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
