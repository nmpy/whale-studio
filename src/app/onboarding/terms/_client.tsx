"use client";

// src/app/onboarding/terms/_client.tsx
// 同意画面の Client 部分。
// Server Component (page.tsx) から渡された terms / privacy のスナップショットを表示し、
// 同意ボタンで両 API を並列 POST する。
//
// 設計:
//   - upsert API のため、既に片方同意済みでも安全に再実行できる
//   - 失敗時は alert ではなく画面内エラー表示

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDevToken } from "@/lib/api-client";

interface PolicySnapshot {
  version: string;
  title:   string;
  body:    string;
}

interface Props {
  terms:   PolicySnapshot;
  privacy: PolicySnapshot;
}

export function TermsConsentClient({ terms, privacy }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function postAccept(path: string, body: object): Promise<void> {
    const res = await fetch(path, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getDevToken()}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg =
        (json as { error?: { message?: string }; message?: string })?.error?.message
        || (json as { message?: string })?.message
        || `${path} の同意に失敗しました (HTTP ${res.status})`;
      throw new Error(msg);
    }
  }

  async function handleAccept() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await Promise.all([
        postAccept("/api/onboarding/terms/accept", { terms_version: terms.version }),
        postAccept("/api/onboarding/privacy/accept", { privacy_policy_version: privacy.version }),
      ]);
      router.push("/onboarding/line-oa");
    } catch (e) {
      setError(e instanceof Error ? e.message : "同意の保存に失敗しました");
      setSubmitting(false);
    }
  }

  function handleCancel() {
    router.push("/login");
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        {terms.title} / プライバシーポリシー
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        Whale Studio をご利用いただくには、以下の利用規約およびプライバシーポリシーをご確認のうえ、ご同意いただく必要があります。
      </p>

      {/* ── 利用規約 ── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 8, color: "#111827" }}>利用規約</h2>
      <div
        style={{
          maxHeight:    "32vh",
          overflowY:    "auto",
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
        {terms.body}
      </div>
      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 20 }}>
        利用規約バージョン: {terms.version}
        <Link href="/terms" target="_blank" rel="noopener" style={{ color: "var(--brand)", textDecoration: "underline", marginLeft: 12 }}>
          別タブで開く
        </Link>
      </p>

      {/* ── プライバシーポリシー ── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 8, color: "#111827" }}>プライバシーポリシー</h2>
      <div
        style={{
          maxHeight:    "32vh",
          overflowY:    "auto",
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
        {privacy.body}
      </div>
      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 20 }}>
        プライバシーポリシーバージョン: {privacy.version}
        <Link href="/privacy" target="_blank" rel="noopener" style={{ color: "var(--brand)", textDecoration: "underline", marginLeft: 12 }}>
          別タブで開く
        </Link>
      </p>

      {error && (
        <div
          style={{
            marginTop:    16,
            padding:      "10px 14px",
            border:       "1px solid #fecaca",
            background:   "#fef2f2",
            color:        "#dc2626",
            borderRadius: 6,
            fontSize:     13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}>
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="btn btn-ghost"
          style={{ padding: "8px 16px" }}
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={submitting}
          className="btn btn-primary"
          style={{ padding: "8px 20px" }}
        >
          {submitting ? "送信中…" : "利用規約およびプライバシーポリシーに同意して進む"}
        </button>
      </div>
    </div>
  );
}
