// src/components/FriendAddSection.tsx
//
// 友だち追加セクション（URL表示 + QRコード）。
// tester/[oaId]/page.tsx, tester/[oaId]/works/page.tsx,
// /oas/[id]/works/page.tsx の3箇所で共用。
//
// Props:
//   addUrl        — 友だち追加 URL（必須）
//   changeHref    — 「URL を変更」リンク先。省略時はボタン非表示（テスター向け）

import Link from "next/link";

interface FriendAddSectionProps {
  addUrl:      string;
  changeHref?: string;
}

export function FriendAddSection({ addUrl, changeHref }: FriendAddSectionProps) {
  return (
    <div style={{
      padding:      "16px 20px",
      background:   "var(--surface)",
      border:       "1px solid var(--border-light)",
      borderRadius: "var(--radius-md)",
      boxShadow:    "var(--shadow-xs)",
      marginTop:    20,
      display:      "flex",
      alignItems:   "flex-start",
      gap:          20,
      flexWrap:     "wrap",
    }}>
      {/* テキスト + ボタン */}
      <div style={{ flex: 1, minWidth: 180 }}>
        <p style={{
          fontSize:      12,
          fontWeight:    700,
          color:         "var(--text-muted)",
          marginBottom:  8,
          letterSpacing: 0.5,
        }}>
          🔗 友だち追加
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <a
            href={addUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ textDecoration: "none", fontSize: 13 }}
          >
            友だち追加URLを開く
          </a>
          {changeHref && (
            <Link
              href={changeHref}
              className="btn btn-ghost"
              style={{ fontSize: 13 }}
            >
              URL を変更
            </Link>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all" }}>
          {addUrl}
        </p>
      </div>

      {/* QRコード */}
      <div style={{ flexShrink: 0, textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>QRコードで追加</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data=${encodeURIComponent(addUrl)}`}
          alt="友だち追加QRコード"
          width={120}
          height={120}
          style={{ borderRadius: 8, border: "1px solid var(--border-light)", display: "block" }}
        />
      </div>
    </div>
  );
}
