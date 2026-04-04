"use client";

// src/components/upgrade/TesterUpgradeCard.tsx
// テスター上限到達時のアップグレード誘導カード。
// variant:
//   "banner"  — 作品リスト上部の横長バナー（works > page.tsx）
//   "gate"    — 新規作成フォームの代わりに表示するフルブロック（works/new > page.tsx）
//   "preview" — プレビュー後のソフト誘導（作品ハブ > [workId]/page.tsx）

interface TesterUpgradeCardProps {
  variant: "banner" | "gate" | "preview";
  /** "preview" variant を非表示にするコールバック */
  onDismiss?: () => void;
  /** 作品リストに戻るリンク用 oaId（"gate" variant で使用） */
  oaId?: string;
}

// ── 共用: プランを見るリンク ──────────────────────────────────────────
function PricingLink({ style }: { style?: React.CSSProperties }) {
  return (
    <a
      href="/pricing"
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
  // ── バナー ──────────────────────────────────────────────────────────
  if (variant === "banner") {
    return (
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          12,
        padding:      "12px 16px",
        background:   "var(--color-primary-soft, #EAF4F1)",
        border:       "1px solid #b9ddd6",
        borderRadius: "var(--radius-md, 10px)",
        marginBottom: 16,
        fontSize:     13,
      }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>🔓</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: "var(--color-primary, #2F6F5E)" }}>
            テスタープランの作品数上限（1 件）に達しています
          </span>
          <span style={{ color: "var(--text-secondary)", marginLeft: 8 }}>
            追加で作品を作成するには、エディター以上へのアップグレードが必要です。
          </span>
        </div>
        <PricingLink style={{
          padding:      "5px 12px",
          borderRadius: "var(--radius-full, 999px)",
          background:   "var(--color-primary, #2F6F5E)",
          color:        "#fff",
          fontSize:     11,
        }} />
      </div>
    );
  }

  // ── ゲート ──────────────────────────────────────────────────────────
  if (variant === "gate") {
    return (
      <div style={{
        maxWidth:     560,
        padding:      "36px 32px",
        background:   "var(--surface, #fff)",
        border:       "1px solid var(--border-light, #e5e7eb)",
        borderRadius: "var(--radius-md, 10px)",
        boxShadow:    "var(--shadow-sm)",
        textAlign:    "center",
      }}>
        <div style={{ fontSize: 44, marginBottom: 16, lineHeight: 1 }}>🔓</div>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800, color: "var(--text-primary, #111827)" }}>
          作品の作成上限に達しています
        </h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary, #6b7280)", marginBottom: 24, lineHeight: 1.7 }}>
          テスタープランでは作品を <strong>1 件まで</strong> しか作成できません。<br />
          さらに作品を追加するには <strong>editor プラン</strong> が必要です。
        </p>

        {/* プランを見るCTA */}
        <a
          href="/pricing"
          style={{
            display:        "inline-flex",
            alignItems:     "center",
            justifyContent: "center",
            width:          "100%",
            maxWidth:       320,
            padding:        "12px 20px",
            borderRadius:   "var(--radius-sm, 8px)",
            background:     "var(--color-primary, #2F6F5E)",
            color:          "#fff",
            fontSize:       14,
            fontWeight:     700,
            textDecoration: "none",
            marginBottom:   12,
          }}
        >
          プランを見る →
        </a>

        {oaId && (
          <div>
            <a
              href={`/oas/${oaId}/works`}
              style={{
                display:        "inline-flex",
                alignItems:     "center",
                gap:            4,
                padding:        "8px 18px",
                borderRadius:   "var(--radius-sm, 6px)",
                background:     "var(--surface, #fff)",
                border:         "1px solid var(--border-light, #e5e7eb)",
                fontSize:       13,
                color:          "var(--text-secondary, #6b7280)",
                textDecoration: "none",
              }}
            >
              ← 作品リストに戻る
            </a>
          </div>
        )}
      </div>
    );
  }

  // ── プレビュー後ソフト誘導 ──────────────────────────────────────────
  return (
    <div style={{
      display:      "flex",
      alignItems:   "flex-start",
      gap:          14,
      padding:      "14px 18px",
      background:   "var(--color-primary-soft, #EAF4F1)",
      border:       "1px solid #b9ddd6",
      borderRadius: "var(--radius-md, 10px)",
      marginBottom: 16,
      fontSize:     13,
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>🎉</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--color-primary, #2F6F5E)", marginBottom: 3 }}>
          プレビューをご確認いただけましたか？
        </div>
        <div style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
          テスタープランでは作品を 1 件まで作成できます。さらに作品を制作するには
          <strong> editor プラン</strong>へのアップグレードが必要です。
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 2 }}>
        <PricingLink />
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background:  "none",
              border:      "none",
              cursor:      "pointer",
              color:       "var(--text-muted)",
              fontSize:    16,
              lineHeight:  1,
              padding:     "2px 4px",
            }}
            title="閉じる"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
