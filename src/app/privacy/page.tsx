// src/app/privacy/page.tsx
// プライバシーポリシー公開ページ (= 認証不要 / read-only)。
// DB の公開版を使う / なければ constants にフォールバック (= helper 経由)。

import type { Metadata } from "next";
import { getCurrentPrivacyPolicyDocument } from "@/lib/policy-document";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title:       "プライバシーポリシー | Whale Studio",
  description: "Whale Studioのプライバシーポリシーです。",
};

export default async function PrivacyPage() {
  const doc = await getCurrentPrivacyPolicyDocument();

  return (
    <div
      style={{
        minHeight: "calc(100vh - 64px)",
        maxWidth:  720,
        margin:    "0 auto",
        padding:   "32px 16px 64px",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        プライバシーポリシー
      </h1>
      {(doc.lastUpdated || doc.effectiveAt) && (
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
          {doc.lastUpdated ? `最終更新日：${doc.lastUpdated}` : null}
          {doc.lastUpdated && doc.effectiveAt ? " ／ " : null}
          {doc.effectiveAt ? `施行日：${doc.effectiveAt}` : null}
        </p>
      )}

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
        プライバシーポリシーバージョン: {doc.version}
      </p>
    </div>
  );
}
