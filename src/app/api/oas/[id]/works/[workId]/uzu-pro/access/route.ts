// GET /api/oas/[id]/works/[workId]/uzu-pro/access
//   現在ユーザーの、この作品に対する for UZU Pro アクセス可否（3 条件）を返す。ナビ表示制御と
//   作品設定画面の状態説明に使う。**他ユーザー / 他 Grant 保持者 / プレイヤー情報は返さない**。
//   実際の強制は常にサーバー側ガード（canAccessUzuPro / authorizeUzuPro）。

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { ok, serverError } from "@/lib/api-response";
import { getUzuProAccess, canManageUzuProWork } from "@/lib/uzupro";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string; workId: string } }) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } }, { status: 401 });
  }
  try {
    const [a, canManage] = await Promise.all([
      getUzuProAccess(params.id, user.id, params.workId),
      canManageUzuProWork(params.id, user.id),
    ]);
    return ok({
      access: a.access,
      workEnabled: a.workEnabled,
      granted: a.granted,
      member: a.member,
      canManage,
    });
  } catch (err) {
    return serverError(err);
  }
}
