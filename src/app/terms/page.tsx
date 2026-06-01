// src/app/terms/page.tsx
// 利用規約公開ページ (= 認証不要 / read-only)。
// DB の公開版を使う / なければ constants にフォールバック (= helper 経由)。

import type { Metadata } from "next";
import { getCurrentTermsDocument } from "@/lib/policy-document";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title:       "利用規約 | Whale Studio",
  description: "Whale Studioの利用規約です。",
};

export default async function TermsPage() {
  const doc = await getCurrentTermsDocument();

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
        {doc.title}
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
        {doc.body}
      </div>

      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
        利用規約バージョン: {doc.version}
      </p>
    </div>
  );
}
