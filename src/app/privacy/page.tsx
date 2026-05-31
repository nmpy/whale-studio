// src/app/privacy/page.tsx
// プライバシーポリシー公開ページ (= 認証不要 / read-only)。
//
// レイアウト:
//   - 利用規約同意画面 (= /onboarding/terms) のスクロール本文と同じ視覚スタイルに揃える。
//   - ただし同意ボタンは持たず、純粋な閲覧用ページ。
//   - SP でも崩れないよう maxWidth 720 + padding を /onboarding/layout.tsx と同等に設定。
//
// metadata: SEO / OGP 表示用。

import type { Metadata } from "next";
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_BODY,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_LAST_UPDATED,
} from "@/lib/constants/privacy-policy";

export const metadata: Metadata = {
  title:       "プライバシーポリシー | Whale Studio",
  description: "Whale Studioのプライバシーポリシーです。",
};

export default function PrivacyPage() {
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
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        最終更新日：{PRIVACY_POLICY_LAST_UPDATED} ／ 施行日：{PRIVACY_POLICY_EFFECTIVE_DATE}
      </p>

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
        {PRIVACY_POLICY_BODY}
      </div>

      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
        プライバシーポリシーバージョン: {CURRENT_PRIVACY_POLICY_VERSION}
      </p>
    </div>
  );
}
