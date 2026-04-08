"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/post-auth-redirect";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [needsUsername, setNeedsUsername] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function checkProfile() {
      // profile が未作成ならユーザー名入力を求める
      try {
        const res = await fetch("/api/profiles/me");
        if (res.status === 404) {
          setNeedsUsername(true);
        }
      } catch {
        // ネットワークエラー等はスキップ（ユーザー名なしで続行）
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
        checkProfile();
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setStatus((prev) => {
          if (prev === "loading") {
            checkProfile();
            return "ready";
          }
          return prev;
        });
      }
    });

    const timer = setTimeout(() => {
      setStatus((prev) => {
        if (prev === "loading") {
          setErrorMsg("セッションの確立に失敗しました。メールのリンクを再度クリックしてください。");
          return "error";
        }
        return prev;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    if (needsUsername && !username.trim()) {
      setErrorMsg("ユーザー名を入力してください。");
      return;
    }
    if (needsUsername && username.trim().length > 20) {
      setErrorMsg("ユーザー名は20文字以内で入力してください。");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("パスワードは8文字以上で入力してください。");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("パスワードが一致しません。");
      return;
    }

    setStatus("submitting");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMsg(
        error.message.toLowerCase().includes("same")
          ? "現在と同じパスワードは使用できません。"
          : error.message
      );
      setStatus("ready");
      return;
    }

    // ユーザー名が必要なら profiles に保存
    if (needsUsername && username.trim()) {
      try {
        await fetch("/api/profiles/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim() }),
        });
      } catch {
        // profiles 保存失敗はブロッキングにしない
      }
    }

    setStatus("done");
    setTimeout(() => router.push(getPostAuthRedirect({ source: "reset-password" })), 1500);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div className="card" style={{ width: 380, padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "#111827" }}>
          WHALE STUDIO
        </h1>

        {status === "loading" && (
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 24 }}>
            セッションを確認中...
          </p>
        )}

        {status === "error" && (
          <div style={{ marginTop: 24 }}>
            <div className="alert alert-error" style={{ fontSize: 13, marginBottom: 16 }}>
              {errorMsg}
            </div>
            <a href="/login" style={{ display: "block", textAlign: "center", fontSize: 13, color: "#2563eb" }}>
              ログイン画面に戻る
            </a>
          </div>
        )}

        {status === "done" && (
          <div style={{ marginTop: 24 }}>
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#166534" }}>
              {needsUsername ? "アカウント情報を設定しました。" : "パスワードを更新しました。"}管理画面に移動します...
            </div>
          </div>
        )}

        {(status === "ready" || status === "submitting") && (
          <>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
              {needsUsername ? "アカウント情報を設定" : "新しいパスワードを設定"}
            </p>
            <form onSubmit={handleSubmit}>

              {/* ユーザー名（profile 未作成時のみ） */}
              {needsUsername && (
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
                <label className="form-label" htmlFor="new-password">
                  新しいパスワード
                </label>
                <input
                  id="new-password"
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="8文字以上"
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="confirm-password">
                  パスワード確認
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="もう一度入力"
                  autoComplete="new-password"
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
                disabled={status === "submitting"}
              >
                {status === "submitting" ? "更新中..." : needsUsername ? "設定を完了" : "パスワードを設定"}
              </button>
            </form>

            <a
              href="/login"
              style={{ display: "block", textAlign: "center", marginTop: 16, fontSize: 12, color: "#6b7280" }}
            >
              ログイン画面に戻る
            </a>
          </>
        )}
      </div>
    </div>
  );
}
