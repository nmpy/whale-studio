"use client";

// src/app/onboarding/terms/page.tsx
// 利用規約 + プライバシーポリシー同意画面。
//
// - 本文をスクロール可能なエリアで 2 つ並べて表示 (= 利用規約 / プライバシーポリシー)
// - 「利用規約およびプライバシーポリシーに同意して進む」ボタン
// - 同意 → POST /api/onboarding/terms/accept + POST /api/onboarding/privacy/accept
//   (= 未同意の方のみ POST する) → /onboarding/line-oa に遷移
// - 既に片方同意済みのユーザー (= privacy 追加時の既存ユーザー) は不足分のみ POST する設計

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDevToken } from "@/lib/api-client";
import { CURRENT_TERMS_VERSION, TERMS_TITLE, TERMS_BODY } from "@/lib/constants/terms";
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_BODY,
} from "@/lib/constants/privacy-policy";

type Status = { ok: boolean; data?: { terms: boolean; privacy: boolean } };

export default function TermsPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // 同意状況を取得 (= 既に同意済みの方は再 POST しないため)
  // /api/onboarding/status 等の既存エンドポイントがあれば理想だが、ここでは
  // 「未同意なら 422 / 同意済みなら 201」を返す upsert API の特性に頼り、
  // 画面ロード時は両方 POST する単純実装でも問題ない (= upsert の update 句が空のため副作用なし)。
  // よってクライアントは「両方とも POST する」とし、サーバー側で冪等性を担保する。
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(true); }, []);

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
        (json as Status & { error?: { message?: string }; message?: string })?.error?.message
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
      // 利用規約 / プライバシーポリシー の両方を並列に同意 (= upsert で冪等のため、
      // 既に片方同意済みのユーザーが叩いても安全)。
      await Promise.all([
        postAccept("/api/onboarding/terms/accept", { terms_version: CURRENT_TERMS_VERSION }),
        postAccept("/api/onboarding/privacy/accept", { privacy_policy_version: CURRENT_PRIVACY_POLICY_VERSION }),
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

  if (!loaded) return null;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{TERMS_TITLE} / プライバシーポリシー</h1>
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
        {TERMS_BODY}
      </div>
      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 20 }}>
        利用規約バージョン: {CURRENT_TERMS_VERSION}
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
        {PRIVACY_POLICY_BODY}
      </div>
      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 20 }}>
        プライバシーポリシーバージョン: {CURRENT_PRIVACY_POLICY_VERSION}
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
          {submitting ? "送信中…" : "利用規約およびプライバシーポリシーに同意して進む"}
        </button>
      </div>
    </div>
  );
}
