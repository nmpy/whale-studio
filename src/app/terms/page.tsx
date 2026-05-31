// src/app/terms/page.tsx
// 利用規約公開ページ (= 認証不要 / read-only)。
//
// 既存の同意画面 (= /onboarding/terms) は初回ログイン時の同意フロー用。
// 本ページは公開ページとして閲覧専用に提供 (= /privacy と同じ位置付け)。
//
// レイアウト / metadata は /privacy と揃える。

import type { Metadata } from "next";
import {
  CURRENT_TERMS_VERSION,
  TERMS_BODY,
  TERMS_TITLE,
} from "@/lib/constants/terms";

export const metadata: Metadata = {
  title:       "利用規約 | Whale Studio",
  description: "Whale Studioの利用規約です。",
};

export default function TermsPage() {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 64px)",
        maxWidth:  720,
        margin:    "0 auto",
        padding:   "32px 16px 64px",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        {TERMS_TITLE}
      </h1>

      <div
        style={{
          padding:      "20px 24px",
          border:       "1px solid #e5e7eb",
          borderRadius: 8,
          background:   "#fafafa",
          whiteSpace:   "pre-wrap",
          fontSize:     14,
          lineHeight:   1.7,
          color:        "#374151",
        }}
      >
        {TERMS_BODY}
      </div>

      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
        利用規約バージョン: {CURRENT_TERMS_VERSION}
      </p>
    </div>
  );
}
