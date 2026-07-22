// src/lib/uzupro-auth.ts
// for ウズプロ API/ページの共通ガード（authorizeLive を踏襲）。
//
// 通過条件（3 条件の AND）:
//   - 認証済み（未ログインは 401）
//   - Work.uzuProEnabled = true かつ UzuProGrant 保有 かつ 当該 OA の active メンバー（canAccessUzuPro）
// ⚠️ platform owner でも Grant が無ければ通さない（迂回不可）。作品(OA)アクセスの判定は
//    getWorkspaceRole の既存短絡を使うが、Grant と Work 有効化は別途必須。
// 露出最小化のため、権限なし/OA・Work 不在/無効はすべて 404 に揃える（存在を露出しない）。

import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { canAccessUzuPro } from "@/lib/uzupro";

export type UzuProAuthOk = {
  ok: true;
  user: { id: string; email?: string };
  /** 判定根拠（ログ用） */
  via: "work_enabled_member_granted";
};
export type UzuProAuthFail = { ok: false; response: NextResponse };

function notFoundResponse(): NextResponse {
  return Res.json(
    { success: false, error: { code: "NOT_FOUND", message: "Not found" } },
    { status: 404 },
  );
}

/**
 * for ウズプロ API の共通ガード。**workId を必須**とし、3 条件（Work有効化 + Grant + active member）を
 * canAccessUzuPro で判定する。ページ/Server Action/API のいずれからも呼べる。
 */
export async function authorizeUzuPro(
  req: NextRequest,
  oaId: string,
  workId: string,
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

  // 3 条件（Work.uzuProEnabled + Grant + active member）を一括判定。1 つでも欠ければ 404。
  if (!(await canAccessUzuPro(oaId, user.id, workId))) {
    return { ok: false, response: notFoundResponse() };
  }
  return { ok: true, user, via: "work_enabled_member_granted" };
}
