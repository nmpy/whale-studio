"use client";

/**
 * FirstGuide — 各画面の初回向けガイドバナー（インライン・軽量）
 *
 * 見た目: 水色の細いバー。HelpAccordion の下、コンテンツの上に置く。
 * !loading && count === 0 のときだけ表示する想定。
 */

interface Props {
  icon?:    string;
  message:  string;
}

export function FirstGuide({ icon = "💡", message }: Props) {
  return (
    <div style={{
      display:      "flex",
      alignItems:   "flex-start",
      gap:          8,
      padding:      "9px 14px",
      background:   "#f0f9ff",
      border:       "1px solid #bae6fd",
      borderRadius: "var(--radius-md)",
      marginBottom: 16,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <p style={{ fontSize: 12, color: "#0369a1", margin: 0, lineHeight: 1.65 }}>
        {message}
      </p>
    </div>
  );
}
