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

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [mode,     setMode]     = useState<"password" | "magic">("password");
  const [status,   setStatus]   = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase 未設定（開発環境）の場合はそのまま管理画面に遷移
  useEffect(() => {
    if (!supabaseConfigured) {
      router.replace(nextPath);
    }
  }, [supabaseConfigured, nextPath, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return;

    setStatus("loading");
    setErrorMsg("");

    const supabase = createSupabaseBrowserClient();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}${nextPath}` },
      });
      if (error) {
        setErrorMsg(error.message);
        setStatus("error");
      } else {
        setStatus("sent");
      }
    } else {
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

        {/* ── マジックリンク送信完了 ── */}
        {status === "sent" ? (
          <div style={{ textAlign: "center", color: "#059669" }}>
            <p style={{ fontSize: 15, fontWeight: 600 }}>メールを送信しました</p>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
              {email} に届いたリンクをクリックしてください。
            </p>
          </div>
        ) : (

          /* ── ログインフォーム ── */
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

            {mode === "password" && (
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
            )}

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
              {status === "loading"
                ? "処理中..."
                : mode === "magic"
                  ? "マジックリンクを送信"
                  : "ログイン"}
            </button>

            <button
              type="button"
              onClick={() => { setMode(mode === "password" ? "magic" : "password"); setErrorMsg(""); }}
              style={{
                width:          "100%",
                marginTop:      10,
                background:     "none",
                border:         "none",
                cursor:         "pointer",
                fontSize:       12,
                color:          "#6b7280",
                textDecoration: "underline",
              }}
            >
              {mode === "password"
                ? "パスワードなしでログイン（マジックリンク）"
                : "パスワードでログイン"}
            </button>
          </form>
        )}
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
