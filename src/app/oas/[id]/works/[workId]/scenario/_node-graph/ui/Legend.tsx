"use client";

// _node-graph/ui/Legend.tsx — 凡例オーバーレイ

function LegendRow({
  color,
  dashed,
  label,
}: {
  color: string;
  dashed?: boolean;
  label: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} role="listitem">
      <svg width={24} height={10} style={{ flexShrink: 0 }} aria-hidden="true">
        <line
          x1={0} y1={5} x2={24} y2={5}
          stroke={color} strokeWidth={2}
          strokeDasharray={dashed ? "4 2" : undefined}
          strokeOpacity={dashed ? 0.6 : 0.9}
        />
        <polygon points="20,2 24,5 20,8" fill={color} fillOpacity={dashed ? 0.6 : 0.9} />
      </svg>
      <span style={{ fontSize: 10, color: "#6b7280" }}>{label}</span>
    </div>
  );
}

export function Legend() {
  return (
    <div
      role="list"
      aria-label="エッジ凡例"
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 10,
        color: "#6b7280",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        zIndex: 10,
      }}
    >
      <LegendRow color="#7c3aed" label="QR → フェーズ遷移" />
      <LegendRow color="#c2410c" label="QR → メッセージ遷移" />
      <LegendRow color="#94a3b8" label="遷移設定（デフォルト）" />
      <LegendRow color="#94a3b8" dashed label="遷移設定（条件付き）" />
      <LegendRow color="#f59e0b" label="ループ遷移" />
    </div>
  );
}
