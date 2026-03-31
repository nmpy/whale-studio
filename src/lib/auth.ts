// src/lib/auth.ts
// Supabase Auth ベースの認証ミドルウェア

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getWorkspaceRole } from '@/lib/rbac';
import type { Role } from '@/lib/types/permissions';
import { roleAtLeast } from '@/lib/types/permissions';

/**
 * リクエストの Authorization: Bearer <token> から認証済みユーザーを取得する。
 *
 * - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されている場合:
 *     Supabase の auth.getUser(token) でトークンを検証する。
 * - 未設定かつ NODE_ENV=development の場合:
 *     開発用スタブとして任意のトークンを受け入れる（本番では必ず Supabase を設定すること）。
 */
export async function getAuthUser(req: NextRequest): Promise<{ id: string } | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  if (!token) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase が設定されている場合は JWT を検証する
  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  }

  // Supabase 未設定 + 開発環境 → スタブ（任意のトークンを受け入れ）
  if (process.env.NODE_ENV === "development") {
    return { id: "dev-user" };
  }

  // 本番環境で Supabase 未設定は認証拒否
  return null;
}

// ─────────────────────────────────────────────────────────
// withAuth — API ルートで認証を必須にするラッパー
// ─────────────────────────────────────────────────────────
type Handler<T = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: T },
  user: { id: string }
) => Promise<NextResponse>;

export function withAuth<T = Record<string, string>>(handler: Handler<T>) {
  return async (req: NextRequest, ctx: { params: T }): Promise<NextResponse> => {
    try {
      const user = await getAuthUser(req);
      if (!user) {
        return NextResponse.json(
          { success: false, error: { code: "UNAUTHORIZED", message: "認証が必要です" } },
          { status: 401 }
        );
      }
      console.log(`[withAuth] ${req.method} ${req.nextUrl.pathname}`);
      return await handler(req, ctx, user);
    } catch (err) {
      console.error(`[withAuth] UNCAUGHT in ${req.method} ${req.nextUrl.pathname}:`, err);
      return NextResponse.json(
        { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
        { status: 500 }
      );
    }
  };
}

// ─────────────────────────────────────────────────────────
// withRole — workspace-scoped role check
// ─────────────────────────────────────────────────────────

type RoleHandler<T = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: T },
  user: { id: string },
  role: Role
) => Promise<NextResponse>;

/**
 * withAuth ＋ workspace ロールチェックを合わせたラッパー。
 * workspaceIdFn でリクエストから workspace_id（= oa_id）を抽出する。
 *
 * @example
 * export const GET = withRole(
 *   ({ params }) => params.id,
 *   'viewer',
 *   async (req, { params }, user, role) => { ... }
 * );
 */
export function withRole<T = Record<string, string>>(
  workspaceIdFn: (ctx: { params: T }) => string | Promise<string>,
  minRole: Role,
  handler: RoleHandler<T>
) {
  return withAuth<T>(async (req, ctx, user) => {
    const workspaceId = await workspaceIdFn(ctx);

    const role = await getWorkspaceRole(workspaceId, user.id);

    if (!role) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'このワークスペースへのアクセス権がありません',
          },
        },
        { status: 403 }
      );
    }

    if (!roleAtLeast(role, minRole)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: '権限が不足しています',
          },
        },
        { status: 403 }
      );
    }

    return handler(req, ctx, user, role);
  });
}
