"use client";
// src/app/login/page.tsx
//
// 本命: Supabase Auth ログインページ
//
// BYPASS_AUTH=true を削除した後はここでログインして cookie を発行する。
// cookie が発行されると、以降のすべての API 呼び出しで自動的に認証が通る。
// フロント側の getDevToken() / Authorization ヘッダーへの依存をなくせる。

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

export default function LoginPage() {
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode]       = useState<"password" | "magic">("password");
  const [status, setStatus]   = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/oas` },
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
        setErrorMsg(error.message);
        setStatus("error");
      } else {
        window.location.href = "/oas";
      }
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display:   "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f8fafc",
    }}>
      <div className="card" style={{ width: 360, padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "#111827" }}>
          WHALE STUDIO
        </h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
          管理画面にログイン
        </p>

        {status === "sent" ? (
          <div style={{ textAlign: "center", color: "#059669" }}>
            <p style={{ fontSize: 15, fontWeight: 600 }}>メールを送信しました</p>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
              {email} に届いたリンクをクリックしてください。
            </p>
          </div>
        ) : (
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
              onClick={() => setMode(mode === "password" ? "magic" : "password")}
              style={{
                width: "100%",
                marginTop: 10,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "#6b7280",
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
