"use client";
// src/app/access-denied/page.tsx
//
// メンバーシップエラー専用ページ
//
// 遷移条件:
//   ?reason=inactive  → メンバーシップ一時停止
//   ?reason=suspended → アカウント利用停止
//   ?reason=forbidden → ワークスペース未所属
//   ?reason=なし      → 汎用アクセス拒否

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ACCESS_DENIED_CONTENT, type AccessDeniedReason } from "@/lib/constants/member-text";

// ── エラー定義は member-text.ts に集約 ─────────────────────────────
const REASONS = ACCESS_DENIED_CONTENT;
type Reason = AccessDeniedReason;

// ── コンポーネント ─────────────────────────────────────────────────
function AccessDeniedContent() {
  const searchParams = useSearchParams();
  const rawReason    = searchParams.get("reason") ?? "default";
  const reason       = (rawReason in REASONS ? rawReason : "default") as Reason;
  const info         = REASONS[reason];

  // Supabase 設定済みのときだけログアウト可能
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  async function handleLogout() {
    if (!supabaseConfigured) {
      window.location.href = "/login";
      return;
    }
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div style={{
      minHeight:      "100vh",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      background:     "#f8fafc",
      padding:        "0 16px",
    }}>
      <div className="card" style={{ width: 420, padding: "40px 32px", textAlign: "center" }}>

        {/* アイコン */}
        <div style={{ fontSize: 48, marginBottom: 16 }}>{info.icon}</div>

        {/* タイトル */}
        <h2 style={{
          fontSize:     20,
          fontWeight:   800,
          color:        "#111827",
          marginBottom: 12,
        }}>
          {info.title}
        </h2>

        {/* 説明 */}
        <p style={{
          fontSize:     14,
          color:        "#6b7280",
          lineHeight:   1.7,
          marginBottom: 28,
        }}>
          {info.body}
        </p>

        {/* エラーコード（デバッグ用） */}
        <div style={{
          background:   "#f9fafb",
          border:       "1px solid #e5e7eb",
          borderRadius: 6,
          padding:      "6px 12px",
          fontSize:     11,
          color:        "#9ca3af",
          marginBottom: 24,
          fontFamily:   "monospace",
        }}>
          error: {rawReason.toUpperCase()}
        </div>

        {/* アクション */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {info.canRetry && (
            <button
              className="btn btn-primary"
              onClick={() => window.history.back()}
            >
              前のページに戻る
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={handleLogout}
          >
            ログアウト
          </button>
        </div>

      </div>
    </div>
  );
}

export default function AccessDeniedPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#6b7280", fontSize: 14 }}>読み込み中...</p>
      </div>
    }>
      <AccessDeniedContent />
    </Suspense>
  );
}
