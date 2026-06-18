"use client";

// src/app/onboarding/review/page.tsx
// 審査中画面。
//
// - 提出済みの権限URL / 提出日時 / 現在ステータスを表示
// - REJECTED の場合は review_note を表示し、修正再提出への導線を出す

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDevToken } from "@/lib/api-client";
import { WhaleLoader } from "@/components/ui/WhaleLoader";

interface OnboardingState {
  id:             string;
  status:         "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  permission_url: string | null;
  submitted_at:   string | null;
  reviewed_at:    string | null;
  review_note:    string | null;
}

const STATUS_LABEL: Record<OnboardingState["status"], string> = {
  DRAFT:      "下書き",
  SUBMITTED:  "審査中",
  IN_REVIEW:  "審査中（確認中）",
  APPROVED:   "承認済み",
  REJECTED:   "差し戻し",
};

const STATUS_COLOR: Record<OnboardingState["status"], { bg: string; fg: string }> = {
  DRAFT:     { bg: "#f3f4f6", fg: "#374151" },
  SUBMITTED: { bg: "#dbeafe", fg: "#1e40af" },
  IN_REVIEW: { bg: "#dbeafe", fg: "#1e40af" },
  APPROVED:  { bg: "#dcfce7", fg: "#166534" },
  REJECTED:  { bg: "#fef3c7", fg: "#92400e" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP");
}

export default function ReviewPage() {
  const router = useRouter();
  const [state,   setState]   = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/onboarding/oa", {
          headers: { Authorization: `Bearer ${getDevToken()}` },
        });
        if (!res.ok) throw new Error("審査状況の取得に失敗しました");
        const json = await res.json();
        setState(json.data);

        // 既に approved なら通常画面へ
        if (json.data.status === "APPROVED") {
          router.replace("/oas");
        }
        // まだ提出していない場合は line-oa に戻す
        if (json.data.status === "DRAFT") {
          router.replace("/onboarding/line-oa");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <WhaleLoader fullScreen />;
  if (error) {
    return <div style={{ padding: 24, color: "#dc2626" }}>{error}</div>;
  }
  if (!state) return null;

  const color = STATUS_COLOR[state.status];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        {state.status === "REJECTED" ? "差し戻しされました" : "審査中です"}
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        {state.status === "REJECTED"
          ? "運営からの差し戻し理由を確認のうえ、修正して再提出してください。"
          : "ご提出いただいた LINE 公式アカウント情報を確認しています。審査が完了すると、Whale Studio の管理画面をご利用いただけるようになります。"}
      </p>

      <div
        style={{
          border:       "1px solid #e5e7eb",
          borderRadius: 10,
          padding:      "20px 22px",
          background:   "#fff",
        }}
      >
        {/* ステータス */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>ステータス</span>
          <span
            style={{
              display:      "inline-flex",
              padding:      "4px 12px",
              borderRadius: 999,
              background:   color.bg,
              color:        color.fg,
              fontSize:     12,
              fontWeight:   700,
            }}
          >
            {STATUS_LABEL[state.status]}
          </span>
        </div>

        {/* 提出日時 */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>提出日時</span>
          <span style={{ fontSize: 13, color: "#111827" }}>{formatDate(state.submitted_at)}</span>
        </div>

        {/* 権限URL */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "#6b7280", flexShrink: 0 }}>権限URL</span>
          <span
            style={{
              fontSize:    13,
              color:       "#2563eb",
              wordBreak:   "break-all",
              textAlign:   "right",
            }}
          >
            {state.permission_url ? (
              <a href={state.permission_url} target="_blank" rel="noopener noreferrer">
                {state.permission_url}
              </a>
            ) : "—"}
          </span>
        </div>

        {state.reviewed_at && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>確認日時</span>
            <span style={{ fontSize: 13, color: "#111827" }}>{formatDate(state.reviewed_at)}</span>
          </div>
        )}

        {state.review_note && (
          <div
            style={{
              marginTop:    16,
              padding:      "12px 14px",
              border:       "1px solid #fde68a",
              background:   "#fffbeb",
              borderRadius: 8,
              fontSize:     13,
              color:        "#92400e",
            }}
          >
            <strong>運営からの連絡</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{state.review_note}</div>
          </div>
        )}
      </div>

      {state.status === "REJECTED" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button
            type="button"
            onClick={() => router.push("/onboarding/line-oa?step=2")}
            className="btn btn-primary"
            style={{ padding: "8px 20px" }}
          >
            内容を修正する
          </button>
        </div>
      )}
    </div>
  );
}
