"use client";

// src/app/oas/[id]/works/[workId]/locations/_qr-panel.tsx
//
// QRタブ — MVP では情報カードと既存QR導線へのリンクを表示する。
// 将来 QR コードを一元管理する画面ができたら、このパネルを差し替える。

import Link from "next/link";

interface Props {
  oaId: string;
  workId: string;
}

export default function QrPanel({ oaId, workId }: Props) {
  const base = `/oas/${oaId}/works/${workId}`;
  return (
    <div data-panel="qr">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>QR</h2>
      </div>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 12, color: "#334155", lineHeight: 1.7 }}>
        現地に設置したQRコードを読み取ることで、チェックイン・メッセージ送信・シナリオ遷移を発火できます。
        QR は「GPS地点のチェックイン用QR」と「メッセージ・遷移用QR」の 2 系統で活用できます。
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {/* GPS 地点の QR チェックイン */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>📍</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1f2937" }}>GPS地点のQRチェックイン</span>
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>
            ロケーションのチェックインモードを <code style={{ fontSize: 11 }}>qr_only</code> または <code style={{ fontSize: 11 }}>qr_and_gps</code> にすると、各ロケーションのQRコードを使ってチェックインを発火できます。
          </p>
          <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`${base}/locations`}
              style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none" }}
            >
              GPSロケーションを管理
            </Link>
            <Link
              href={`${base}/locations/print`}
              style={{ padding: "6px 14px", background: "#f3f4f6", color: "#374151", borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none", border: "1px solid #e5e7eb" }}
            >
              QR一括印刷
            </Link>
          </div>
        </div>

        {/* メッセージ・遷移用 QR */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🔗</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1f2937" }}>メッセージ・遷移用QR</span>
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>
            遷移先URL（destination）として登録した LIFF / 内部URL / 外部URL は、そのままQRコード化して現地に設置できます。シナリオの起点や演出ジャンプに活用してください。
          </p>
          <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`${base}/destinations`}
              style={{ padding: "6px 14px", background: "#0d9488", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none" }}
            >
              遷移先URLを管理
            </Link>
          </div>
        </div>

        {/* 友だち追加 QR（OAスコープ） */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>👋</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1f2937" }}>友だち追加QR</span>
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>
            LINE公式アカウントへの友だち追加導線として、各OAの「友だち追加設定」から共有用QRを取得できます。
          </p>
          <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`/oas/${oaId}/friend-add`}
              style={{ padding: "6px 14px", background: "#f3f4f6", color: "#374151", borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none", border: "1px solid #e5e7eb" }}
            >
              友だち追加設定へ
            </Link>
          </div>
        </div>

        {/* 今後の拡張 */}
        <div style={{ background: "#fefce8", border: "1px dashed #fde68a", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🛠️</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>今後の拡張</span>
          </div>
          <p style={{ fontSize: 12, color: "#92400e", lineHeight: 1.6, margin: 0 }}>
            QRコードを一元管理する専用画面（独立したQRトークンの発行・印刷・利用統計）を追加予定です。それまでは上記の各画面からQRを利用してください。
          </p>
        </div>
      </div>
    </div>
  );
}
