// src/app/oas/[id]/live/_LivePlaceholder.tsx
// Live 各 section の Phase 1 準備中ページ（説明文 + 準備中表示）。Server Component。

import Link from "next/link";

export function LivePlaceholder({
  oaId,
  title,
  description,
}: {
  oaId: string;
  title: string;
  description: string;
}) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 0 40px" }}>
      <Link
        href={`/oas/${oaId}/live`}
        style={{ fontSize: 12, color: "var(--text-muted, #6b7280)", textDecoration: "none" }}
      >
        ← Whale Studio Live
      </Link>

      <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 12, marginBottom: 8, color: "#111827" }}>
        {title}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.9, color: "#374151", whiteSpace: "pre-wrap" }}>
        {description}
      </p>

      <div
        style={{
          marginTop: 24,
          padding: "18px 20px",
          borderRadius: 12,
          border: "1px solid #bae6fd",
          background: "#f0f9ff",
          color: "#0369a1",
          fontSize: 13,
          lineHeight: 1.8,
        }}
      >
        🐋 この画面は準備中です。Phase 1 では権限・表示制御・ルーティングのみを提供しています。
        リアルタイム管制機能は今後のフェーズで追加予定です。
      </div>
    </div>
  );
}
