"use client";

// src/app/pricing/page.tsx
// プランページ — tester → editor アップグレード導線

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { trackEvent } from "@/lib/event-tracker";
import { getDevToken } from "@/lib/api-client";
import { useIsMobile } from "@/hooks/useIsMobile";

// ── チェックアイテム ─────────────────────────────────────────────────
function CheckItem({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div style={{
      display:    "flex",
      alignItems: "flex-start",
      gap:        10,
      fontSize:   13,
      color:      muted ? "var(--text-muted)" : "var(--text-secondary)",
      lineHeight: 1.6,
    }}>
      <span style={{
        flexShrink:  0,
        marginTop:   2,
        width:       18,
        height:      18,
        borderRadius: "50%",
        background:  muted ? "var(--gray-100)" : "var(--color-primary-soft, #EAF4F1)",
        display:     "flex",
        alignItems:  "center",
        justifyContent: "center",
        fontSize:    10,
        color:       muted ? "var(--text-muted)" : "var(--color-primary, #2F6F5E)",
        fontWeight:  700,
      }}>✓</span>
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

// ── メインページ ──────────────────────────────────────────────────────
export default function PricingPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const sp           = useIsMobile();
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    // ?source= クエリパラメータで流入元を記録（例: /pricing?source=header）
    const source = searchParams.get("source") ?? undefined;
    const token  = getDevToken();

    // 課金専用ログ（billing_event_logs）
    trackBillingEvent("pricing_view", token, source);

    // 汎用行動ログ（event_logs）
    trackEvent("screen_view",      { page: "/pricing" },                           { token });
    trackEvent("upgrade_interest", { action: "view", source },                     { token });
    trackEvent("flow_step",        { step: "pricing", source: source ?? "direct" }, { token });
  // searchParams は mount 時に1回だけ読めば十分
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUpgrade() {
    const token  = getDevToken();
    const source = searchParams.get("source") ?? undefined;
    trackBillingEvent("pricing_cta_click", token);
    trackEvent("upgrade_interest", { action: "cta_click", source }, { token });
    window.dispatchEvent(
      new CustomEvent("open-feedback-modal", {
        detail: { pricingSource: source },
      })
    );
    setRequested(true);
  }

  return (
    <div style={{
      maxWidth:  600,
      margin:    "0 auto",
      padding:   sp ? "20px 0 48px" : "40px 0 64px",
    }}>

      {/* ── ヘッダー ── */}
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
          小さくはじめて、必要なときに広げる。
        </h1>
        <p style={{
          fontSize:   13,
          color:      "var(--text-secondary)",
          lineHeight: 1.8,
        }}>
          Whale Studio は、今すぐ全部決めなくていいツールです。<br />
          お試し利用から本格運用まで、ペースに合わせてステップアップできます。
        </p>
      </div>

      {/* ── コンセプト 3 点 ── */}
      <div style={{
        display:      "flex",
        gap:          sp ? 6 : 8,
        marginBottom: sp ? 20 : 28,
        flexDirection: sp ? "column" : "row",
        flexWrap:     "wrap",
      }}>
        {[
          { icon: "🌱", text: "まず1作品、気軽に試せる" },
          { icon: "🔓", text: "無理に決めなくていい" },
          { icon: "📈", text: "成長に合わせてプラン変更できる" },
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
            <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

      {/* ── 現在のご利用状況（tester プラン） ── */}
      <div className="card" style={{ marginBottom: 12, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <SectionLabel>いまのご利用状況</SectionLabel>
          <span style={{
            padding:      "2px 10px",
            borderRadius: "var(--radius-full)",
            fontSize:     11,
            fontWeight:   700,
            background:   "#fef3c7",
            color:        "#92400e",
            border:       "1px solid #fde68a",
          }}>
            tester プラン
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CheckItem>1 作品をじっくり試作できる</CheckItem>
          <CheckItem>キャラクター・メッセージ・フローをひと通り体験</CheckItem>
          <CheckItem>プレビューで動作確認</CheckItem>
        </div>
        <p style={{
          marginTop:  14,
          fontSize:   12,
          color:      "var(--text-muted)",
          lineHeight: 1.6,
          paddingTop: 12,
          borderTop:  "1px solid var(--border-light)",
        }}>
          まずはここからスタート。制作の感触をつかんでから、次のステップを検討できます。
        </p>
      </div>

      {/* ── editor でできること ── */}
      <div style={{
        padding:      "20px 24px",
        marginBottom: 28,
        background:   "var(--color-primary-soft, #EAF4F1)",
        border:       "1px solid #b9ddd6",
        borderRadius: "var(--radius-md)",
      }}>
        <SectionLabel>editor プランに移ると</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CheckItem>複数の作品を並行して制作・管理できる</CheckItem>
          <CheckItem>制作した作品をそのまま本番公開できる</CheckItem>
          <CheckItem>継続的に改善・運用を続けられる</CheckItem>
        </div>
        <p style={{
          marginTop:  12,
          fontSize:   12,
          color:      "#2d5a4e",
          lineHeight: 1.6,
          paddingTop: 10,
          borderTop:  "1px solid #b9ddd6",
        }}>
          現在の作品・キャラクター・フローはそのまま引き継がれます。
        </p>
      </div>

      {/* ── プランカード ── */}
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
          editor プラン
        </h3>

        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: sp ? 28 : 34, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>
            ¥9,800
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 4 }}>
            / 月
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
          <CheckItem>作品数の上限なし</CheckItem>
          <CheckItem>本番公開・継続運用</CheckItem>
          <CheckItem>現在の作品・データを引き継ぎ</CheckItem>
        </div>

        {/* CTA 前の安心文 */}
        <p style={{
          fontSize:     13,
          color:        "var(--text-secondary)",
          lineHeight:   1.7,
          marginBottom: 16,
        }}>
          まだ検討中でも大丈夫です。<br />
          まずはお気軽にご相談ください。
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
            ✓ ご相談フォームを開きました。内容を送信してください。
          </div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleUpgrade}
            style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "12px 20px" }}
          >
            editorプランについて相談する
          </button>
        )}

        <Link
          href="/oas"
          style={{
            display:    "block",
            marginTop:  12,
            fontSize:   13,
            color:      "var(--text-muted)",
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
          fontSize:     12,
          fontWeight:   700,
          color:        "var(--text-muted)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          marginBottom: 16,
          textAlign:    "center",
        }}>
          ご相談前に知っておいてほしいこと
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            {
              icon: "🤝",
              title: "無理な営業はしません",
              body:  "ご相談いただいた内容をもとに、個別にご案内します。その場でのお申し込みを求めることはありません。",
            },
            {
              icon: "🐣",
              title: "現在はβ版です",
              body:  "Whale Studio はまだ成長中のサービスです。一緒に育てていただけるユーザーさんを大切にしています。",
            },
            {
              icon: "💬",
              title: "個別サポートがあります",
              body:  "はじめての導入や使い方の相談など、担当が個別にサポートします。一人で抱え込まなくて大丈夫です。",
            },
          ].map(({ icon, title, body }) => (
            <div key={title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{
                fontSize:    18,
                flexShrink:  0,
                marginTop:   1,
                width:       28,
                textAlign:   "center",
              }}>
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
