// src/lib/supabase/server.ts
// サーバーコンポーネント・Server Action 向け Supabase クライアントファクトリ
//
// Next.js App Router の Server Component から呼び出す。
// `next/headers` の cookies() を使って cookie を読み書きするため、
// このファイルは必ず Server Component または Server Action からのみ呼ぶこと。
// （Client Component からは createBrowserClient を使うこと）

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Server Action 向け Supabase クライアントを生成する。
 *
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定の場合は
 * null を返す（開発環境バイパスモード）。
 */
export async function createSupabaseServerClient() {
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component から呼ばれた場合 set は無視される（読み取り専用）
          // Middleware でリフレッシュされるため問題なし
        }
      },
    },
  });
}

/**
 * 現在のセッションユーザーを取得する（Server Component 向け）。
 *
 * - Supabase 未設定（開発バイパスモード）の場合:
 *     BYPASS_AUTH=true → { id: "bypass-admin", email: undefined }
 *     NODE_ENV=development → { id: "dev-user", email: undefined }
 * - Supabase 設定済みの場合: JWT 検証済みユーザーを返す（失敗時は null）
 */
export async function getServerUser(): Promise<{ id: string; email?: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // ── 開発バイパスモード（本番環境では無効） ──────────────────────────
  if (!supabaseUrl) {
    if (process.env.NODE_ENV === "production") {
      console.error("[getServerUser] Supabase URL 未設定 + 本番環境: 認証不可");
      return null;
    }
    const bypassOn = process.env.BYPASS_AUTH?.trim().toLowerCase() === "true";
    if (bypassOn) return { id: "bypass-admin" };
    if (process.env.NODE_ENV === "development") return { id: "dev-user" };
    return null;
  }

  // ── Supabase 本番モード ────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  return { id: user.id, email: user.email ?? undefined };
}
