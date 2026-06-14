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
import { CURRENT_TERMS_VERSION } from "@/lib/constants/terms";
import { CURRENT_PRIVACY_POLICY_VERSION } from "@/lib/constants/privacy-policy";

const ACCESS_DENIED_MESSAGES = LOGIN_ERROR_BANNERS;

function LoginForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const nextPath    = searchParams.get("next") ?? getPostAuthRedirect({ source: "login" });
  const errorReason = searchParams.get("error");
  // STUDIO LP (whale-studio.app) の「今すぐ始める / ログイン」から
  // app.whale-studio.app/login?mode=register&email=... で遷移してくる導線をサポート。
  const initialMode  = searchParams.get("mode") === "register" ? "register" : "login";
  const initialEmail = searchParams.get("email") ?? "";

  const [mode,            setMode]            = useState<"login" | "register">(initialMode);
  const [username,        setUsername]         = useState("");
  const [email,           setEmail]            = useState(initialEmail);
  const [password,        setPassword]         = useState("");
  const [confirmPassword, setConfirmPassword]  = useState("");
  // 利用規約 / プライバシーポリシー同意（登録時必須）
  const [agreeTerms,      setAgreeTerms]        = useState(false);
  const [agreePrivacy,    setAgreePrivacy]      = useState(false);
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
    if (!email.trim()) { setErrorMsg("メールアドレスを入力してください"); setStatus("error"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErrorMsg("有効なメールアドレスを入力してください"); setStatus("error"); return; }
    if (!password) { setErrorMsg("パスワードを入力してください"); setStatus("error"); return; }
    if (password.length < 8) { setErrorMsg("パスワードは8文字以上で入力してください"); setStatus("error"); return; }
    if (password !== confirmPassword) { setErrorMsg("パスワードが一致しません"); setStatus("error"); return; }
    if (!agreeTerms) { setErrorMsg("利用規約への同意が必要です"); setStatus("error"); return; }
    if (!agreePrivacy) { setErrorMsg("プライバシーポリシーへの同意が必要です"); setStatus("error"); return; }

    setStatus("loading");
    const supabase = createSupabaseBrowserClient();

    // 同意情報は user_metadata にも載せる。メール確認 ON でセッションが取れない場合、
    // 初回認証時に onboarding ガード側で同意ログ / acceptance を materialize するため。
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: username.trim(),
          registration_consent: {
            terms_version:   CURRENT_TERMS_VERSION,
            privacy_version: CURRENT_PRIVACY_POLICY_VERSION,
            agreed_at:       new Date().toISOString(),
          },
        },
      },
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

    // セッション取得できた場合 → 同意ログ + プロフィール + 同意ゲートをサーバー側で記録してリダイレクト。
    // 失敗してもブロッキングにはしない（万一失敗しても onboarding の同意ゲートで担保される）。
    try {
      await fetch("/api/auth/register-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          terms_agreed: true,
          privacy_agreed: true,
        }),
      });
    } catch {
      // 記録失敗はブロッキングにしない
    }

    window.location.href = nextPath;
  }

  if (!supabaseConfigured) return null;

  const accessDenied = errorReason ? ACCESS_DENIED_MESSAGES[errorReason] : null;

  // 登録ボタンの活性条件（登録モードのみ）: 全必須入力 + メール形式 + パスワード一致 + 両同意。
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canRegister =
    username.trim().length > 0 &&
    email.trim().length > 0 && emailValid &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword &&
    agreeTerms && agreePrivacy;
  // ログインモードは従来どおり（送信中のみ disabled）。登録モードは未充足なら disabled。
  const submitDisabled = status === "loading" || (mode === "register" && !canRegister);

  // ── アカウント登録完了（メール確認待ち） ──
  if (registerDone) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div className="card" style={{ width: 380, padding: 32 }}>
          <h1 style={{ marginBottom: 4 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/whale-studio-logo.png"
            alt="Whale Studio"
            width={192}
            height={40}
            style={{ display: "block", maxWidth: "100%", height: "auto" }}
          />
        </h1>
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
    <div className="login-screen" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div className="card" style={{ width: 380, padding: 32 }}>

        <h1 style={{ marginBottom: 4 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/whale-studio-logo.png"
            alt="Whale Studio"
            width={192}
            height={40}
            style={{ display: "block", maxWidth: "100%", height: "auto" }}
          />
        </h1>
        <p style={{ fontSize: 13, fontWeight: 400, color: "#6b7280", marginBottom: 24 }}>
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
              <label className="form-label" htmlFor="username">
                ユーザー名
                <span style={{ color: "#dc2626", fontSize: 11, marginLeft: 6, fontWeight: 700 }}>必須</span>
              </label>
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
            <label className="form-label" htmlFor="email">
              メールアドレス
              {mode === "register" && <span style={{ color: "#dc2626", fontSize: 11, marginLeft: 6, fontWeight: 700 }}>必須</span>}
            </label>
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
            <label className="form-label" htmlFor="password">
              パスワード
              {mode === "register" && <span style={{ color: "#dc2626", fontSize: 11, marginLeft: 6, fontWeight: 700 }}>必須</span>}
            </label>
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
              <label className="form-label" htmlFor="confirmPassword">
                パスワード（確認）
                <span style={{ color: "#dc2626", fontSize: 11, marginLeft: 6, fontWeight: 700 }}>必須</span>
              </label>
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

          {/* ── 利用規約 / プライバシーポリシー同意（登録モードのみ・必須） ── */}
          {mode === "register" && (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>利用規約</a>
                  に同意します
                </span>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                <input
                  type="checkbox"
                  checked={agreePrivacy}
                  onChange={(e) => setAgreePrivacy(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>プライバシーポリシー</a>
                  に同意します
                </span>
              </label>
            </div>
          )}

          {errorMsg && (
            <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 13 }}>{errorMsg}</div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{
              width: "100%",
              marginTop: 8,
              ...(submitDisabled ? { opacity: 0.5, cursor: "not-allowed" } : {}),
            }}
            disabled={submitDisabled}
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
