// src/lib/uzupro-auth.ts
// for ウズプロ API/ページの共通ガード（authorizeLive を踏襲）。
//
// 通過条件:
//   - 認証済み（未ログインは 401）
//   - platform owner、または（UzuProGrant 保有 かつ 当該 OA の active メンバー）
// 露出最小化のため、権限なし/OA 不在はすべて 404 に揃える（存在を露出しない）。

import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import { hasUzuProGrant } from "@/lib/uzupro";

export type UzuProAuthOk = {
  ok: true;
  user: { id: string; email?: string };
  /** 判定根拠（ログ用） */
  via: "platform_admin" | "oa_member_granted";
};
export type UzuProAuthFail = { ok: false; response: NextResponse };

function notFoundResponse(): NextResponse {
  return Res.json(
    { success: false, error: { code: "NOT_FOUND", message: "Not found" } },
    { status: 404 },
  );
}

/**
 * for ウズプロ API の共通ガード。ページ/Server Action/API のいずれからも呼べる。
 * 失敗時は適切なステータスの NextResponse を返す。成功時は user / via を返す。
 */
export async function authorizeUzuPro(
  req: NextRequest,
  oaId: string,
): Promise<UzuProAuthOk | UzuProAuthFail> {
  const user = await getAuthUser(req);
  if (!user) {
    return {
      ok: false,
      response: Res.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } },
        { status: 401 },
      ),
    };
  }

  const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { id: true } });
  if (!oa) return { ok: false, response: notFoundResponse() };

  if (isPlatformOwner(user.id)) {
    return { ok: true, user, via: "platform_admin" };
  }

  if (!(await hasUzuProGrant(user.id))) {
    return { ok: false, response: notFoundResponse() };
  }
  const info = await getWorkspaceRole(oaId, user.id);
  if (info && info.status === "active") {
    return { ok: true, user, via: "oa_member_granted" };
  }
  return { ok: false, response: notFoundResponse() };
}
