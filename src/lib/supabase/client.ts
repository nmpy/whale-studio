"use client";
/**
 * Supabase ブラウザクライアントファクトリ
 *
 * @supabase/ssr の createBrowserClient を使うことで
 * セッションが cookie に保存され、middleware / Server Component から参照できる。
 * （旧: @supabase/supabase-js の createClient は localStorage を使うため middleware 非対応）
 *
 * 使い方:
 *   const supabase = createSupabaseBrowserClient();
 *   await supabase.auth.signInWithPassword({ email, password });
 */

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
