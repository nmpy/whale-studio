"use client";

// src/app/onboarding/terms/page.tsx
// 利用規約同意画面。
//
// - 本文をスクロール可能なエリアで表示
// - 「同意して進む」「キャンセル」
// - 同意 → POST /api/onboarding/terms/accept → /onboarding/line-oa に遷移
// - キャンセル → /login (Supabase auth signOut せずに離脱、必要なら user 側で明示ログアウト)

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDevToken } from "@/lib/api-client";
import { CURRENT_TERMS_VERSION, TERMS_TITLE, TERMS_BODY } from "@/lib/constants/terms";

export default function TermsPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function handleAccept() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/terms/accept", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getDevToken()}`,
        },
        body: JSON.stringify({ terms_version: CURRENT_TERMS_VERSION }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message || "利用規約の同意に失敗しました");
      }
      router.push("/onboarding/line-oa");
    } catch (e) {
      setError(e instanceof Error ? e.message : "利用規約の同意に失敗しました");
      setSubmitting(false);
    }
  }

  function handleCancel() {
    // ログイン画面へ戻す（Supabase signOut は別途 user が明示的に行う想定）
    router.push("/login");
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{TERMS_TITLE}</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        Whale Studio をご利用いただくには、以下の利用規約に同意していただく必要があります。
      </p>

      {/* ── スクロール可能な本文エリア ── */}
      <div
        style={{
          maxHeight:    "55vh",
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
        {TERMS_BODY}
      </div>

      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
        利用規約バージョン: {CURRENT_TERMS_VERSION}
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

      {/* ── アクションボタン ── */}
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
          {submitting ? "送信中…" : "同意して進む"}
        </button>
      </div>
    </div>
  );
}
