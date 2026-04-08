"use client";

// src/app/settings/profile/page.tsx
// ユーザープロフィール設定ページ（username の表示・編集）

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";

export default function ProfileSettingsPage() {
  const router = useRouter();
  const { profile, loading, refresh } = useProfile();

  const [username, setUsername]   = useState("");
  const [saving, setSaving]      = useState(false);
  const [message, setMessage]    = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (profile) setUsername(profile.username);
  }, [profile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const trimmed = username.trim();
    if (!trimmed) {
      setMessage({ type: "error", text: "ユーザー名を入力してください" });
      return;
    }
    if (trimmed.length > 20) {
      setMessage({ type: "error", text: "ユーザー名は20文字以内で入力してください" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profiles/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setMessage({ type: "error", text: json.error?.message ?? "保存に失敗しました" });
      } else {
        setMessage({ type: "success", text: "ユーザー名を更新しました" });
        refresh();
      }
    } catch {
      setMessage({ type: "error", text: "通信エラーが発生しました" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 16px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
        プロフィール設定
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>
        ヘッダーやワークスペースで表示されるユーザー名を設定します。
      </p>

      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>読み込み中...</div>
      )}

      {!loading && (
        <div className="card" style={{ padding: 28 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-username">
                ユーザー名
              </label>
              <input
                id="profile-username"
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={20}
                placeholder="例: ぽよちゃん"
                required
              />
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                1〜20文字。絵文字も使用できます。
              </p>
            </div>

            {message && (
              <div
                className={message.type === "error" ? "alert alert-error" : "alert alert-success"}
                style={{ marginBottom: 16, fontSize: 13 }}
              >
                {message.text}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => router.back()}
              >
                戻る
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
