"use client";
// src/app/login/page.tsx
//
// Supabase Auth ログイン / アカウント登録ページ
//
// mode: "login" — メール + パスワードでログイン
// mode: "register" — ユーザー名 + メール + パスワード + 確認で新規登録
//
// セッションは @supabase/ssr の createBrowserClient によって cookie に保存される。
// middleware.ts がその cookie を読んで保護ルートへのアクセスを制御する。

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { LOGIN_ERROR_BANNERS } from "@/lib/constants/member-text";
import { getPostAuthRedirect } from "@/lib/post-auth-redirect";

const ACCESS_DENIED_MESSAGES = LOGIN_ERROR_BANNERS;

function LoginForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const nextPath    = searchParams.get("next") ?? getPostAuthRedirect({ source: "login" });
  const errorReason = searchParams.get("error");

  const [mode,            setMode]            = useState<"login" | "register">("login");
  const [username,        setUsername]         = useState("");
  const [email,           setEmail]            = useState("");
  const [password,        setPassword]         = useState("");
  const [confirmPassword, setConfirmPassword]  = useState("");
  const [status,          setStatus]           = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg,        setErrorMsg]         = useState("");
  // パスワードリセット
  const [resetStatus,     setResetStatus]      = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [resetMsg,        setResetMsg]         = useState("");
  // アカウント登録完了（メール確認待ち）
  const [registerDone,      setRegisterDone]       = useState(false);

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!supabaseConfigured) router.replace(nextPath);
  }, [supabaseConfigured, nextPath, router]);

  // ── パスワードリセット ──
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
      setResetMsg(
        error.message.toLowerCase().includes("rate limit")
          ? "短時間に操作が集中しています。数分待ってから再度お試しください。"
          : error.message
      );
      setResetStatus("error");
      if (error.message.toLowerCase().includes("rate limit")) {
        setTimeout(() => setResetStatus("idle"), 30000);
      }
    } else {
      setResetMsg("パスワード設定用のリンクをお送りしました。メールをご確認ください。");
      setResetStatus("sent");
    }
  }

  // ── ログイン ──
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return;
    setStatus("loading");
    setErrorMsg("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.includes("Invalid login credentials")
        ? "メールアドレスまたはパスワードが正しくありません"
        : error.message.includes("Email not confirmed")
        ? "メールアドレスの確認が完了していません。確認メールをご確認ください"
        : error.message.toLowerCase().includes("rate limit")
        ? "短時間に操作が集中しています。数分待ってから再度お試しください。"
        : error.message;
      setErrorMsg(msg);
      setStatus("error");
    } else {
      window.location.href = nextPath;
    }
  }

  // ── アカウント登録 ──
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return;
    setErrorMsg("");

    if (!username.trim()) { setErrorMsg("ユーザー名を入力してください"); setStatus("error"); return; }
    if (username.trim().length > 20) { setErrorMsg("ユーザー名は20文字以内で入力してください"); setStatus("error"); return; }
    if (password.length < 8) { setErrorMsg("パスワードは8文字以上で入力してください"); setStatus("error"); return; }
    if (password !== confirmPassword) { setErrorMsg("パスワードが一致しません"); setStatus("error"); return; }

    setStatus("loading");
    const supabase = createSupabaseBrowserClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: username.trim() } },
    });

    if (signUpError) {
      const msg = signUpError.message.includes("already registered")
        ? "このメールアドレスは既に登録されています。ログインしてください。"
        : signUpError.message.toLowerCase().includes("rate limit")
        ? "短時間に操作が集中しています。数分待ってから再度お試しください。"
        : signUpError.message;
      setErrorMsg(msg);
      setStatus("error");
      return;
    }

    const session = data.session;

    if (!session) {
      // Supabase メール確認 ON → メール確認待ち
      setRegisterDone(true);
      setStatus("idle");
      return;
    }

    // セッション取得できた場合 → profiles に保存してリダイレクト
    try {
      await fetch("/api/profiles/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
    } catch {
      // profiles 保存失敗はブロッキングにしない
    }

    window.location.href = nextPath;
  }

  if (!supabaseConfigured) return null;

  const accessDenied = errorReason ? ACCESS_DENIED_MESSAGES[errorReason] : null;

  // ── アカウント登録完了（メール確認待ち） ──
  if (registerDone) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div className="card" style={{ width: 380, padding: 32 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "#111827" }}>WHALE STUDIO</h1>
          <div style={{ marginTop: 24, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "14px 16px", fontSize: 13, color: "#166534", lineHeight: 1.7 }}>
            確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。
          </div>
          <button
            type="button"
            onClick={() => { setRegisterDone(false); setMode("login"); }}
            style={{ marginTop: 20, width: "100%", padding: "8px 0", background: "none", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#374151" }}
          >
            ログイン画面に戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div className="card" style={{ width: 380, padding: 32 }}>

        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "#111827" }}>WHALE STUDIO</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
          {mode === "login" ? "管理画面にログイン" : "アカウントを作成"}
        </p>

        {accessDenied && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>{accessDenied.title}</p>
            <p style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.6 }}>{accessDenied.body}</p>
          </div>
        )}

        <form onSubmit={mode === "login" ? handleLogin : handleRegister}>

          {/* ── ユーザー名（登録モードのみ） ── */}
          {mode === "register" && (
            <div className="form-group">
              <label className="form-label" htmlFor="username">ユーザー名</label>
              <input
                id="username"
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="山田 太郎"
                maxLength={20}
                autoComplete="name"
                autoFocus
              />
            </div>
          )}

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
              placeholder={mode === "register" ? "8文字以上" : "••••••••"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
            {mode === "register" && password.length > 0 && password.length < 8 && (
              <span style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>8文字以上で入力してください</span>
            )}
          </div>

          {/* ── パスワード確認（登録モードのみ） ── */}
          {mode === "register" && (
            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">パスワード（確認）</label>
              <input
                id="confirmPassword"
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="もう一度入力"
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <span style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>パスワードが一致しません</span>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 13 }}>{errorMsg}</div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={status === "loading"}
          >
            {status === "loading"
              ? "処理中..."
              : mode === "login" ? "ログイン" : "アカウントを作成"}
          </button>
        </form>

        {/* ── モード切替 ── */}
        <div style={{ marginTop: 16, borderTop: "1px solid #f3f4f6", paddingTop: 14 }}>
          {mode === "login" ? (
            <>
              <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginBottom: 8 }}>
                アカウントをお持ちでない方
              </p>
              <button
                type="button"
                onClick={() => { setMode("register"); setErrorMsg(""); setStatus("idle"); }}
                style={{ width: "100%", padding: "8px 0", background: "none", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#374151", transition: "border-color .15s, color .15s" }}
              >
                アカウント登録はこちら
              </button>

              {/* パスワードリセット */}
              <div style={{ marginTop: 12 }}>
                {resetStatus === "sent" ? (
                  <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#166534", lineHeight: 1.6 }}>
                    {resetMsg}
                  </div>
                ) : (
                  <>
                    {resetStatus === "error" && resetMsg && (
                      <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", marginBottom: 6 }}>{resetMsg}</p>
                    )}
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={resetStatus === "loading"}
                      style={{ width: "100%", padding: "6px 0", background: "none", border: "none", cursor: resetStatus === "loading" ? "not-allowed" : "pointer", fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}
                    >
                      {resetStatus === "loading" ? "送信中..." : "パスワードをお忘れの方"}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginBottom: 8 }}>
                既にアカウントをお持ちの方
              </p>
              <button
                type="button"
                onClick={() => { setMode("login"); setErrorMsg(""); setStatus("idle"); }}
                style={{ width: "100%", padding: "8px 0", background: "none", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#374151", transition: "border-color .15s, color .15s" }}
              >
                ログインはこちら
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
