// src/lib/with-platform-admin.ts
// プラットフォームオーナー専用ルートの認証ラッパー
//
// 使い方:
//   export const GET = withPlatformAdmin(async (req, ctx, user) => { ... });
//
// - withAuth でログイン検証済みユーザーを取得した後
// - isPlatformOwner(user.id) で権限チェックを行う
// - 非オーナーには 403 を返す

import { withAuth } from "@/lib/auth";
import { forbidden } from "@/lib/api-response";
import { isPlatformOwner } from "@/lib/platform-admin";
import type { NextRequest, NextResponse } from "next/server";
import { isAnyWorkspaceOwner } from "@/lib/rbac";

/**
 * プラットフォームオーナー専用の認証ラッパー。
 * isPlatformOwner チェックを withAuth の後に追加する。
 */

export function withPlatformAdmin<P extends Record<string, string> = Record<string, string>>(
  handler: PlatformAdminHandler<P>
) {
  return withAuth<P>(async (req, ctx, user) => {
    const isPlatform = isPlatformOwner(user.id);
    const isWorkspaceOwner = await isAnyWorkspaceOwner(user.id);

    if (!isPlatform && !isWorkspaceOwner) {
      return forbidden();
    }

    return handler(req, ctx, user);
  });
}

type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: P;
};

type PlatformAdminHandler<P extends Record<string, string> = Record<string, string>> = (
  req: NextRequest,
  ctx: RouteContext<P>,
  user: { id: string }
) => Promise<NextResponse>;