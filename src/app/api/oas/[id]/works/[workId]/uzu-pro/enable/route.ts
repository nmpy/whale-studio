// PATCH /api/oas/[id]/works/[workId]/uzu-pro/enable
//   作品単位の for UZU Pro 有効化 / 無効化。owner / platform owner のみ（サーバー側で再検証）。
//   無効化してもプレイヤー/リンク/同期データは削除しない（アクセス判定のみ変わる）。冪等。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, forbidden, serverError } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { canManageUzuProWork } from "@/lib/uzupro";
import { recordUzuProActivity } from "@/lib/uzupro/activity";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ enabled: z.boolean() }).strict();

export async function PATCH(req: NextRequest, { params }: { params: { id: string; workId: string } }) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } }, { status: 401 });
  }
  // クライアント表示だけの制御にしない: 変更権限をサーバー側で再検証（owner / platform owner のみ）。
  if (!(await canManageUzuProWork(params.id, user.id))) return forbidden();

  try {
    const { enabled } = bodySchema.parse(await req.json());

    const work = await prisma.work.findFirst({
      where: { id: params.workId, oaId: params.id },
      select: { id: true, uzuProEnabled: true },
    });
    if (!work) return notFound("作品");

    if (work.uzuProEnabled === enabled) {
      return ok({ uzuProEnabled: enabled, changed: false }); // 冪等・変化なし
    }

    await prisma.work.update({ where: { id: work.id }, data: { uzuProEnabled: enabled } });
    await recordUzuProActivity(prisma, {
      oaId: params.id,
      workId: params.workId,
      actorUserId: user.id,
      action: enabled ? "work_enabled" : "work_disabled",
      targetType: "work",
      targetId: params.workId,
    });
    return ok({ uzuProEnabled: enabled, changed: true });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力が不正です");
    return serverError(err);
  }
}
