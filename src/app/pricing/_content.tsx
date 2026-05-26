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

/** 個人利用プランカード定義。
 *  Basic / Standard / Pro / Plus の順で表示する (= user request)。
 *  価格は未確定のため "料金は準備中" / "詳細はお問い合わせください" 表記。
 *  CTA は FeedbackModal を開く「相談する」のみ。Stripe checkout は当面オフ
 *  (= 金額未確定のためエラー導線にならないようにする)。 */
interface PersonalPlanCard {
  /** 内部キー (= future plan-guard との接続用、現時点では表示制御のみ) */
  tier:        "basic" | "standard" | "pro" | "plus";
  label:       string;
  tagline:     string;
  price:       string;
  priceUnit:   string;
  features:    string[];
  /** 推奨タグを出すか (= 中心的に推したいプラン) */
  recommended?: boolean;
}

const PERSONAL_PLAN_CARDS: readonly PersonalPlanCard[] = [
  {
    tier:    "basic",
    label:   "Basic",
    tagline: "小さく作品づくりを始めたい方向け",
    price:   "料金は準備中",
    priceUnit: "",
    features: [
      "1 作品をじっくり試作できる",
      "キャラクター・メッセージ・フローを編集",
      "プレビューで動作確認",
    ],
  },
  {
    tier:    "standard",
    label:   "Standard",
    tagline: "継続的に作品を制作・管理したい方向け",
    price:   "料金は準備中",
    priceUnit: "",
    features: [
      "複数作品の制作・管理",
      "オーディエンス分析・セグメント",
      "トラッキング機能",
    ],
  },
  {
    tier:    "pro",
    label:   "Pro",
    tagline: "公開・運用・分析までしっかり使いたい方向け",
    price:   "料金は準備中",
    priceUnit: "",
    recommended: true,
    features: [
      "Standard の全機能",
      "LIFF 表示設定 / 遷移先URL設定",
      "ロケーション機能 (GPS / ビーコン / QR)",
    ],
  },
  {
    tier:    "plus",
    label:   "Plus",
    tagline: "より大きな規模や複数作品の運用を見据えた方向け",
    price:   "詳細はお問い合わせください",
    priceUnit: "",
    features: [
      "複数作品の並行運用",
      "高度な分析・運用支援",
      "個別の拡張要件にも対応",
    ],
  },
];

/** 法人プランの定義 (= 別カード扱い、個人利用とは分けて表示) */
const ENTERPRISE_PLAN = {
  label:       "法人プラン",
  price:       "お問い合わせください",
  description: "企業・IP・イベント・舞台連動など、個別要件に合わせた導入をご相談いただけます。",
  ctaText:     "法人プランについて相談する",
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
  const heading = (source ? SOURCE_HEADING[source] : null) ?? DEFAULT_HEADING;

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

      {/* ── 個人利用プラン (4 ティア grid) ── */}
      <SectionLabel>個人利用プラン</SectionLabel>
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: sp ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
          gap:                 sp ? 12 : 14,
          marginTop:           10,
          marginBottom:        28,
        }}
      >
        {PERSONAL_PLAN_CARDS.map((plan) => {
          const isRecommended = plan.recommended === true;
          return (
            <div
              key={plan.tier}
              style={{
                position:     "relative",
                background:   "var(--surface)",
                border:       `${isRecommended ? "2px" : "1px"} solid ${isRecommended ? "var(--color-primary, #2F6F5E)" : "var(--border-light)"}`,
                borderRadius: "var(--radius-lg)",
                padding:      sp ? "20px 18px" : "22px 20px",
                boxShadow:    isRecommended ? "var(--shadow-md)" : "var(--shadow-xs)",
                display:      "flex",
                flexDirection: "column",
                gap:          10,
              }}
            >
              {/* 推奨タグ */}
              {isRecommended && (
                <span style={{
                  position:    "absolute",
                  top:         -10,
                  left:        14,
                  padding:     "2px 10px",
                  background:  "var(--color-primary, #2F6F5E)",
                  color:       "#fff",
                  fontSize:    10,
                  fontWeight:  700,
                  letterSpacing: "0.05em",
                  borderRadius: "var(--radius-full)",
                }}>
                  おすすめ
                </span>
              )}

              <h3 style={{
                fontSize:     18,
                fontWeight:   800,
                color:        "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}>
                {plan.label}
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {plan.tagline}
              </p>

              <div style={{ paddingTop: 4, paddingBottom: 4 }}>
                <p style={{
                  fontSize:   plan.price.length > 8 ? 14 : 22,
                  fontWeight: 700,
                  color:      "var(--text-primary)",
                  letterSpacing: "-0.02em",
                }}>
                  {plan.price}
                  {plan.priceUnit && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4, fontWeight: 500 }}>
                      {plan.priceUnit}
                    </span>
                  )}
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
                {plan.features.map((f) => (
                  <CheckItem key={f}>{f}</CheckItem>
                ))}
              </div>

              <button
                type="button"
                onClick={handleUpgrade}
                style={{
                  marginTop:    "auto",
                  display:      "flex",
                  alignItems:   "center",
                  justifyContent: "center",
                  width:        "100%",
                  padding:      "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background:   isRecommended ? "var(--color-primary, #2F6F5E)" : "var(--surface)",
                  color:        isRecommended ? "#fff" : "var(--text-secondary)",
                  border:       `1px solid ${isRecommended ? "var(--color-primary, #2F6F5E)" : "var(--border-default, #d1d5db)"}`,
                  fontSize:     12,
                  fontWeight:   600,
                  cursor:       "pointer",
                  boxSizing:    "border-box",
                }}
              >
                {plan.label}プランを相談する
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 法人プラン (個人利用とは分けて表示) ── */}
      <SectionLabel>法人プラン</SectionLabel>
      <div
        style={{
          background:   "#f8fafc",
          border:       "1px dashed var(--border-default, #d1d5db)",
          borderRadius: "var(--radius-lg)",
          padding:      sp ? "22px 18px" : "28px 28px",
          marginTop:    10,
          marginBottom: 28,
          display:      "flex",
          flexDirection: sp ? "column" : "row",
          alignItems:   sp ? "stretch" : "center",
          justifyContent: "space-between",
          gap:          sp ? 16 : 24,
        }}
      >
        <div style={{ flex: 1 }}>
          <h3 style={{
            fontSize:    18,
            fontWeight:  800,
            color:       "var(--text-primary)",
            marginBottom: 6,
          }}>
            {ENTERPRISE_PLAN.label}
          </h3>
          <p style={{
            fontSize:     16,
            fontWeight:   700,
            color:        "var(--text-primary)",
            marginBottom: 6,
          }}>
            {ENTERPRISE_PLAN.price}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            {ENTERPRISE_PLAN.description}
          </p>
        </div>
        <div style={{ flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleUpgrade}
            style={{
              padding:      "11px 22px",
              borderRadius: "var(--radius-sm)",
              background:   "var(--color-primary, #2F6F5E)",
              color:        "#fff",
              border:       "none",
              fontSize:     13,
              fontWeight:   700,
              cursor:       "pointer",
              whiteSpace:   "nowrap",
            }}
          >
            {ENTERPRISE_PLAN.ctaText}
          </button>
        </div>
      </div>

      {/* 既存 Stripe Checkout flow — 金額確定済みプランへの直接申し込み導線 (oaId があるときのみ) */}
      {oaId && (
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <button
            onClick={handleStripeCheckout}
            disabled={checkoutLoading}
            style={{
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            6,
              padding:        "10px 22px",
              borderRadius:   "var(--radius-sm)",
              background:     checkoutLoading ? "var(--color-primary-soft, #EAF4F1)" : "var(--color-primary, #2F6F5E)",
              color:          checkoutLoading ? "var(--color-primary, #2F6F5E)" : "#fff",
              fontSize:       13,
              fontWeight:     700,
              border:         "none",
              cursor:         checkoutLoading ? "not-allowed" : "pointer",
              boxSizing:      "border-box",
            }}
          >
            {checkoutLoading ? "処理中..." : "💳 Stripe で申し込む"}
          </button>
        </div>
      )}

      {/* CTA フィードバック (= 相談フォームを開いた後の確認表示) */}
      {requested && (
        <div style={{
          padding:      "12px",
          borderRadius: "var(--radius-sm)",
          background:   "var(--color-primary-soft, #EAF4F1)",
          border:       "1px solid #b9ddd6",
          fontSize:     13,
          color:        "var(--color-primary, #2F6F5E)",
          fontWeight:   600,
          marginBottom: 12,
          textAlign:    "center",
        }}>
          ご相談フォームを開きました。内容を送信してください。
        </div>
      )}

      <Link
        href="/oas"
        style={{
          display:   "block",
          marginTop: 8,
          fontSize:  13,
          color:     "var(--text-muted)",
          textAlign: "center",
        }}
      >
        もう少し試してみる
      </Link>

    </div>
  );
}
