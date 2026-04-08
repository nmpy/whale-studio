// src/lib/auth.ts
// Supabase Auth ベースの認証ミドルウェア

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceRole } from '@/lib/rbac';
import type { Role } from '@/lib/types/permissions';
import { roleAtLeast } from '@/lib/types/permissions';
import { prisma } from '@/lib/prisma';

// ─────────────────────────────────────────────────────────
// AppActivityLog — 認証済みユーザーの操作記録（fire-and-forget）
// ─────────────────────────────────────────────────────────

/**
 * profile が存在しない既存ユーザーに対して lazy に作成する。
 * ログイン時にまだ profile 行がないケース（v1以前のユーザー）を救済する。
 *
 * - fire-and-forget でリクエストをブロックしない
 * - 同一プロセス内で userId ごとに 1 回だけ実行（in-memory Set）
 */
const _profileChecked = new Set<string>();

function ensureProfile(userId: string, email?: string): void {
  if (userId === "bypass-admin" || userId === "dev-user") return;
  if (_profileChecked.has(userId)) return;
  _profileChecked.add(userId);

  prisma.profile.findUnique({ where: { userId } })
    .then((profile) => {
      if (profile) return;
      const fallbackName = email?.split("@")[0] ?? "ユーザー";
      return prisma.profile.create({
        data: { userId, username: fallbackName },
      });
    })
    .catch(() => { /* silent */ });
}

/**
 * アプリ操作ユーザーを記録する（メンバー招待候補の母集団管理用）。
 *
 * - 30分以内に記録済みなら何もしない（in-memory throttle でDB書き込みを抑制）
 * - await しない（fire-and-forget: リクエストをブロックしない）
 * - エラーは無視（記録失敗はサイレントに扱う）
 */
const _activityThrottle = new Map<string, number>();
const ACTIVITY_THROTTLE_MS = 30 * 60 * 1000; // 30分

function recordUserActivity(userId: string, email?: string): void {
  // dev スタブ・bypass は記録不要
  if (userId === "bypass-admin" || userId === "dev-user") return;

  const now  = Date.now();
  const last = _activityThrottle.get(userId) ?? 0;
  if (now - last < ACTIVITY_THROTTLE_MS) return;

  _activityThrottle.set(userId, now);

  // Fire-and-forget: リクエストをブロックしない
  prisma.appActivityLog.upsert({
    where:  { userId },
    update: {
      lastSeenAt: new Date(),
      ...(email ? { email } : {}),
    },
    create: {
      userId,
      email:     email ?? null,
      lastSeenAt: new Date(),
    },
  }).catch(() => { /* silent */ });
}

/**
 * リクエストから認証済みユーザーを取得する。
 *
 * 認証フロー（優先順位順）:
 *  0. BYPASS_AUTH=true (サーバー専用env) → 認証スキップ ★暫定★ 本番運用前に削除
 *  1. Supabase Auth cookie が存在する → cookie から JWT を取得して検証
 *  2. Authorization: Bearer <token> が存在する場合:
 *     2a. NEXT_PUBLIC_SUPABASE_URL / ANON_KEY が設定されている → Supabase JWT 検証
 *     2b. Supabase 未設定 + NODE_ENV=development → 開発スタブ（任意トークン許可）
 *  3. いずれも該当しない → null（401）
 */
export async function getAuthUser(req: NextRequest): Promise<{ id: string; email?: string } | null> {
  const path = `${req.method} ${req.nextUrl.pathname}`;

  // ── 0. 暫定バイパス（開発環境のみ有効）──────────────────────
  // ⚠ 本番環境（NODE_ENV=production）では BYPASS_AUTH を無視する。
  // これにより、本番に env を消し忘れても認証がスキップされない。
  const bypassRaw = process.env.BYPASS_AUTH;
  const bypassOn  = bypassRaw?.trim().toLowerCase() === "true"
    && process.env.NODE_ENV !== "production";
  console.log(
    `[Auth] BYPASS_AUTH raw=${JSON.stringify(bypassRaw)} resolved=${bypassOn} env=${process.env.NODE_ENV} path=${path}`
  );
  if (bypassOn) {
    console.warn(`[Auth] ⚠️  BYPASS_AUTH=true (dev) — 認証スキップ中 path=${path}`);
    return { id: "bypass-admin" };
  }
  if (bypassRaw?.trim().toLowerCase() === "true" && process.env.NODE_ENV === "production") {
    console.error(`[Auth] 🚨 BYPASS_AUTH=true は本番環境では無効です。環境変数を削除してください path=${path}`);
  }

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── 1. Supabase Auth cookie から認証（@supabase/ssr 経由） ──────
  // middleware.ts と同じ createServerClient を使って cookie を読む。
  // @supabase/ssr v0.10 の base64url エンコーディング・チャンク分割に対応。
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            // NextRequest の cookies API から全 cookie を取得
            return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
          },
          setAll() {
            // API Route Handler では Set-Cookie を返す必要がないためno-op
            // (middleware が cookie refresh を担当する)
          },
        },
      });
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.warn(`[Auth] Cookie 認証エラー path=${path} error="${error.message}"`);
        // cookie が無効でも Authorization ヘッダーにフォールバック
      } else if (data.user) {
        console.log(`[Auth] Cookie 認証成功 path=${path} userId=${data.user.id}`);
        return { id: data.user.id, email: data.user.email ?? undefined };
      } else {
        console.log(`[Auth] Cookie からユーザー取得できず path=${path} — Authorization ヘッダーを試行`);
      }
    } catch (err) {
      console.warn(`[Auth] Cookie 認証例外 path=${path}`, err);
    }
  }

  // ── 2. Authorization: Bearer <token> ────────────────────────────
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    console.warn(`[Auth] 認証情報なし path=${path} cookie有無=${!!(req.headers.get("cookie"))} authorization="${auth ?? "(none)"}"`);
    return null;
  }

  const token = auth.slice(7);
  if (!token) {
    console.warn(`[Auth] Bearer トークンが空 path=${path}`);
    return null;
  }

  // ── 2a. Supabase JWT 検証（Bearer）──
  if (supabaseUrl && supabaseAnonKey) {
    console.log(`[Auth] Bearer JWT 検証開始 path=${path} tokenPrefix="${token.slice(0, 12)}..."`);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      console.warn(`[Auth] Bearer JWT 検証エラー path=${path} error="${error.message}" status=${error.status}`);
      return null;
    }
    if (!data.user) {
      console.warn(`[Auth] Bearer: Supabase user が null path=${path}`);
      return null;
    }
    console.log(`[Auth] Bearer 認証成功 path=${path} userId=${data.user.id}`);
    return { id: data.user.id, email: data.user.email ?? undefined };
  }

  // ── 2b. 開発環境スタブ ──
  if (process.env.NODE_ENV === "development") {
    console.log(`[Auth] 開発スタブ認証 path=${path} token="${token}"`);
    return { id: "dev-user" };
  }

  // ── 3. 認証手段なし ──
  console.error(`[Auth] 認証手段なし: NEXT_PUBLIC_SUPABASE_URL も BYPASS_AUTH も未設定 path=${path}`);
  return null;
}

// extractSupabaseTokenFromCookie は削除済み。
// @supabase/ssr の createServerClient を使って cookie を読む（base64url / chunk 対応）。

// ─────────────────────────────────────────────────────────
// withAuth — API ルートで認証を必須にするラッパー
// ─────────────────────────────────────────────────────────
type Handler<T = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: T },
  user: { id: string; email?: string }
) => Promise<NextResponse>;

export function withAuth<T = Record<string, string>>(handler: Handler<T>) {
  return async (req: NextRequest, ctx: { params: T }): Promise<NextResponse> => {
    const method   = req.method;
    const pathname = req.nextUrl.pathname;

    // ── BYPASS_AUTH（開発環境のみ） ──
    const bypassRaw = process.env.BYPASS_AUTH;
    const bypassOn  = bypassRaw?.trim().toLowerCase() === "true"
      && process.env.NODE_ENV !== "production";
    console.log(
      `[withAuth] ENTRY method=${method} path=${pathname}`,
      `BYPASS_AUTH_raw=${JSON.stringify(bypassRaw)} BYPASS_AUTH_resolved=${bypassOn} env=${process.env.NODE_ENV}`
    );

    if (bypassOn) {
      console.warn(`[withAuth] ⚠️ BYPASS_AUTH=true (dev) — 認証スキップ method=${method} path=${pathname}`);
      try {
        return await handler(req, ctx, { id: "bypass-admin" });
      } catch (err) {
        console.error(`[withAuth] BYPASS handler error method=${method} path=${pathname}:`, err);
        return NextResponse.json(
          { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
          { status: 500 }
        );
      }
    }

    try {
      const user = await getAuthUser(req);
      if (!user) {
        const bypassRaw2   = process.env.BYPASS_AUTH;
        const hasBypass    = bypassRaw2?.trim().toLowerCase() === "true";
        const hasSupabase  = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
        const authHeader   = req.headers.get("authorization") ?? "(none)";
        const cookieHeader = req.headers.get("cookie") ?? "";
        const hasSupaCookie = /sb-.+-auth-token/.test(cookieHeader);
        console.warn(
          `[withAuth] 401`,
          `path=${req.method} ${req.nextUrl.pathname}`,
          `BYPASS_AUTH_raw=${JSON.stringify(bypassRaw2)}`,
          `BYPASS_AUTH_resolved=${hasBypass}`,
          `Supabase設定=${hasSupabase}`,
          `supabase_cookie=${hasSupaCookie}`,
          `authHeader="${authHeader.slice(0, 40)}..."`
        );
        return NextResponse.json(
          {
            success: false,
            error: {
              code:    "UNAUTHORIZED",
              message: "認証が必要です",
              hint:    hasBypass
                ? "BYPASS_AUTH=true なのに通過しませんでした（内部エラー）"
                : hasSupabase && !hasSupaCookie
                  ? "Supabase ログインが必要です（cookie なし）"
                  : hasSupabase
                    ? "Supabase cookie/token 検証に失敗しました"
                    : "BYPASS_AUTH=true または Supabase 設定が必要です",
            },
          },
          { status: 401 }
        );
      }
      console.log(`[withAuth] 認証OK ${req.method} ${req.nextUrl.pathname} userId=${user.id}`);
      // 操作ユーザーを記録 & profile 自動作成（fire-and-forget: リクエストをブロックしない）
      recordUserActivity(user.id, user.email);
      ensureProfile(user.id, user.email);
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
 * allowedRoles の指定方法:
 *  - 単一 Role 文字列 ('editor') → roleAtLeast による階層チェック（editor 以上が通過）
 *  - Role[] 配列 (['owner', 'admin']) → 配列に含まれるロールのみ通過（完全一致）
 *
 * @example
 * export const GET = withRole(
 *   ({ params }) => params.id,
 *   'viewer',                       // viewer 以上（全ロール）が通過
 *   async (req, { params }, user, role) => { ... }
 * );
 *
 * export const DELETE = withRole(
 *   ({ params }) => params.id,
 *   ['owner', 'admin'],             // owner か admin のみ通過
 *   async (req, { params }, user, role) => { ... }
 * );
 */
export function withRole<T = Record<string, string>>(
  workspaceIdFn: (ctx: { params: T }) => string | Promise<string>,
  allowedRoles: Role | Role[],
  handler: RoleHandler<T>
) {
  return withAuth<T>(async (req, ctx, user) => {
    // ── BYPASS_AUTH（開発環境のみ）: bypass-admin は権限チェックをスキップ ──
    if (user.id === "bypass-admin" && process.env.NODE_ENV !== "production") {
      const label = Array.isArray(allowedRoles) ? allowedRoles.join('|') : allowedRoles;
      console.warn(
        `[withRole] ⚠️ BYPASS_AUTH (dev) — 権限チェックスキップ`,
        `path=${req.method} ${req.nextUrl.pathname}`,
        `allowedRoles=${label} → bypass as owner`
      );
      return handler(req, ctx, user, "owner");
    }

    const workspaceId = await workspaceIdFn(ctx);

    const member = await getWorkspaceRole(workspaceId, user.id);

    // 1. 未所属
    if (!member) {
      return NextResponse.json(
        { success: false, error: { code: 'WORKSPACE_ACCESS_DENIED', message: 'このワークスペースへのアクセス権がありません' } },
        { status: 403 }
      );
    }

    // 2. inactive（一時停止）
    if (member.status === 'inactive') {
      return NextResponse.json(
        { success: false, error: { code: 'MEMBER_INACTIVE', message: 'メンバーシップが一時停止されています' } },
        { status: 403 }
      );
    }

    // 3. suspended（強制停止）
    if (member.status === 'suspended') {
      return NextResponse.json(
        { success: false, error: { code: 'MEMBER_SUSPENDED', message: 'このアカウントは利用停止されています。オーナーにお問い合わせください' } },
        { status: 403 }
      );
    }

    // 4. ロールチェック
    const allowed = Array.isArray(allowedRoles)
      ? allowedRoles.includes(member.role)
      : roleAtLeast(member.role, allowedRoles);

    if (!allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: '権限が不足しています' } },
        { status: 403 }
      );
    }

    return handler(req, ctx, user, member.role);
  });
}
