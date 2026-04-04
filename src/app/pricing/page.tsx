"use client";

// src/app/pricing/page.tsx
// プランページ — tester → editor アップグレード導線

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  const router  = useRouter();
  const [requested, setRequested] = useState(false);

  function handleUpgrade() {
    // フィードバックモーダルを開いてプラン申請を促す
    window.dispatchEvent(new CustomEvent("open-feedback-modal"));
    setRequested(true);
  }

  return (
    <div style={{
      maxWidth:  600,
      margin:    "0 auto",
      padding:   "40px 0 64px",
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
          あなたの物語を、もっと自由に。
        </h1>
        <p style={{
          fontSize:   13,
          color:      "var(--text-secondary)",
          lineHeight: 1.8,
        }}>
          Whale Studio では、LINE 上での物語体験を制作できます。<br />
          現在はお試し利用中です。
        </p>
      </div>

      {/* ── 現在のご利用状況（tester プラン） ── */}
      <div className="card" style={{ marginBottom: 12, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <SectionLabel>現在のご利用状況</SectionLabel>
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
          <CheckItem>1 作品の制作</CheckItem>
          <CheckItem>キャラクター・メッセージ・フローの作成</CheckItem>
          <CheckItem>プレビュー確認</CheckItem>
        </div>
        <p style={{
          marginTop:  14,
          fontSize:   12,
          color:      "var(--text-muted)",
          lineHeight: 1.6,
          paddingTop: 12,
          borderTop:  "1px solid var(--border-light)",
        }}>
          基本的な制作機能はすべてお試しいただけます。
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
        <SectionLabel>editor プランでできること</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CheckItem>複数作品の制作・管理</CheckItem>
          <CheckItem>継続的な作品制作</CheckItem>
          <CheckItem>本格的な運用（公開・改善）</CheckItem>
        </div>
      </div>

      {/* ── プランカード ── */}
      <div style={{
        background:   "var(--surface)",
        border:       "2px solid var(--color-primary, #2F6F5E)",
        borderRadius: "var(--radius-lg)",
        padding:      "32px 28px",
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
          おすすめ
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
          <span style={{ fontSize: 34, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>
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
          複数作品の制作や、継続的な運用が可能になります。
        </p>

        <div style={{
          display:       "flex",
          flexDirection: "column",
          gap:           8,
          marginBottom:  24,
          padding:       "16px 20px",
          background:    "var(--bg)",
          borderRadius:  "var(--radius-sm)",
          textAlign:     "left",
        }}>
          <CheckItem>複数作品の制作</CheckItem>
          <CheckItem>制限なしで制作</CheckItem>
          <CheckItem>継続的な運用</CheckItem>
        </div>

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
            ✓ ご連絡フォームを開きました。内容を送信してください。
          </div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleUpgrade}
            style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "12px 20px" }}
          >
            このプランを使う
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

      {/* ── 補足 ── */}
      <div style={{
        textAlign:  "center",
        padding:    "20px",
        background: "var(--surface)",
        border:     "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
      }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
          まだ検討中の方へ
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8 }}>
          現在の作品はそのまま保持されます。<br />
          必要なタイミングで、いつでもアップグレードできます。
        </p>
      </div>

    </div>
  );
}
