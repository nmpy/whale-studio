"use client";

// src/hooks/useProfile.ts
// 現在ログイン中のユーザーの profile を取得するフック。
// AppHeader 等での username 表示に使用。
// profile が存在しない既存ユーザーには Supabase user_metadata から lazy 作成する。

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface Profile {
  id: string;
  user_id: string;
  username: string;
}

async function fetchOrCreateProfile(): Promise<Profile | null> {
  // 1. まず GET で既存 profile を取得
  const res = await fetch("/api/profiles/me");
  if (res.ok) {
    const json = await res.json();
    if (json.success) return json.data;
  }

  // 2. 404 = profile 未作成 → Supabase user_metadata から lazy 作成
  if (res.status === 404) {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      const displayName = data.user?.user_metadata?.display_name;
      const fallbackName = typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : "ユーザー";

      const putRes = await fetch("/api/profiles/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: fallbackName }),
      });
      if (putRes.ok) {
        const putJson = await putRes.json();
        if (putJson.success) return putJson.data;
      }
    } catch {
      // lazy 作成失敗は無視
    }
  }

  return null;
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchOrCreateProfile()
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return {
    profile,
    username: profile?.username ?? null,
    loading,
    /** profile を手動で更新した後に再取得する */
    refresh: () => {
      setLoading(true);
      fetchOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {})
        .finally(() => setLoading(false));
    },
  };
}
