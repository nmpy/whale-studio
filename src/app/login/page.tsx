"use client";
// src/app/login/page.tsx
//
// Supabase Auth ログインページ
//
// セッションは @supabase/ssr の createBrowserClient によって cookie に保存される。
// middleware.ts がその cookie を読んで保護ルートへのアクセスを制御する。

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { LOGIN_ERROR_BANNERS } from "@/lib/constants/member-text";

// ── アクセス拒否バナー定義は member-text.ts に集約 ─────────────────
const ACCESS_DENIED_MESSAGES = LOGIN_ERROR_BANNERS;

// ── ログインフォーム本体 ─────────────────────────────────────────────
function LoginForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const nextPath   = searchParams.get("next") ?? "/oas";
  const errorReason = searchParams.get("error");

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [status,       setStatus]       = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg,     setErrorMsg]     = useState("");
  // パスワード設定/再設定
  const [resetStatus,  setResetStatus]  = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [resetMsg,     setResetMsg]     = useState("");

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase 未設定（開発環境）の場合はそのまま管理画面に遷移
  useEffect(() => {
    if (!supabaseConfigured) {
      router.replace(nextPath);
    }
  }, [supabaseConfigured, nextPath, router]);

  async function handlePasswordReset() {
    if (!supabaseConfigured) return;
    if (!email.trim()) {
      setResetMsg("メールアドレスを入力してから押してください");
      setResetStatus("error");
      return;
    }
    setResetStatus("loading");
    setResetMsg("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      setResetMsg(error.message);
      setResetStatus("error");
    } else {
      setResetMsg("パスワード設定用のリンクをお送りしました。メールをご確認ください。");
      setResetStatus("sent");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return;

    setStatus("loading");
    setErrorMsg("");

    const supabase = createSupabaseBrowserClient();

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // メッセージを日本語化
      const msg = error.message.includes("Invalid login credentials")
        ? "メールアドレスまたはパスワードが正しくありません"
        : error.message.includes("Email not confirmed")
        ? "メールアドレスの確認が完了していません。確認メールをご確認ください"
        : error.message;
      setErrorMsg(msg);
      setStatus("error");
    } else {
      // cookie が発行されたのでリダイレクト
      // router.push だと middleware の cookie 読み取りタイミングがずれることがあるため
      // window.location.href で確実にページ遷移する
      window.location.href = nextPath;
    }
  }

  // Supabase 未設定なら何も表示しない（useEffect でリダイレクト済み）
  if (!supabaseConfigured) return null;

  const accessDenied = errorReason ? ACCESS_DENIED_MESSAGES[errorReason] : null;

  return (
    <div style={{
      minHeight:      "100vh",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      background:     "#f8fafc",
    }}>
      <div className="card" style={{ width: 380, padding: 32 }}>

        {/* ── ブランド ── */}
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "#111827" }}>
          WHALE STUDIO
        </h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
          管理画面にログイン
        </p>

        {/* ── アクセス拒否バナー（inactive / suspended / forbidden 時） ── */}
        {accessDenied && (
          <div style={{
            background:   "#fef2f2",
            border:       "1px solid #fecaca",
            borderRadius: 8,
            padding:      "10px 14px",
            marginBottom: 20,
          }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>
              {accessDenied.title}
            </p>
            <p style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.6 }}>
              {accessDenied.body}
            </p>
          </div>
        )}

        {/* ── ログインフォーム ── */}
        <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="email">メールアドレス</label>
              <input
                id="email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@example.com"
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">パスワード</label>
              <input
                id="password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {errorMsg && (
              <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 13 }}>
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 8 }}
              disabled={status === "loading"}
            >
              {status === "loading" ? "処理中..." : "ログイン"}
            </button>

            {/* ── パスワード設定/再設定 ── */}
            <div style={{ marginTop: 16, borderTop: "1px solid #f3f4f6", paddingTop: 14 }}>
              {resetStatus === "sent" ? (
                  <div style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontSize: 12,
                    color: "#166534",
                    lineHeight: 1.6,
                  }}>
                    📬 {resetMsg}
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginBottom: 8 }}>
                      初めてログインする場合や、パスワードを忘れた場合
                    </p>
                    {resetStatus === "error" && resetMsg && (
                      <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", marginBottom: 6 }}>
                        {resetMsg}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={resetStatus === "loading"}
                      style={{
                        width:          "100%",
                        padding:        "8px 0",
                        background:     "none",
                        border:         "1px solid #d1d5db",
                        borderRadius:   8,
                        cursor:         resetStatus === "loading" ? "not-allowed" : "pointer",
                        fontSize:       12,
                        fontWeight:     600,
                        color:          "#374151",
                        transition:     "border-color .15s, color .15s",
                      }}
                    >
                      {resetStatus === "loading" ? "送信中..." : "パスワードを設定する / 再設定する"}
                    </button>
                  </>
                )}
              </div>
          </form>
      </div>
    </div>
  );
}

// Suspense で useSearchParams をラップ（Next.js 14 の要件）
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#6b7280", fontSize: 14 }}>読み込み中...</p>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
