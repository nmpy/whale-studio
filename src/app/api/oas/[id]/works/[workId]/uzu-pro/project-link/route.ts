// PATCH /api/oas/[id]/works/[workId]/uzu-pro/project-link
//   作品と UZU Pro CMS の Project を対応づける（Work.uzuProjectId）。
//   owner / platform owner のみ（サーバー側で再検証）。冪等。
//
//   uzuProjectId を null にすると連携解除。解除しても Whale 側の
//   プレイヤー / チケットリンク / 送信済みイベントは削除しない
//   （以後 UZU への新規イベント送信を止めるだけ）。
//
//   ここでは UUID 形式のみ検証し、UZU 側に実在するかは問い合わせない。
//   最終的な対応関係は UZU 受信時に projectId ↔ Connector.config(oaId/workId) で
//   再検証され、誤設定は TENANT_MISMATCH として安全に拒否される。
//
//   レスポンスは { uzuProjectId, changed } のみ（内部情報を出さない）。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, forbidden, serverError } from "@/lib/api-response";
import { getAuthUser } from "@/lib/auth";
import { canManageUzuProWork } from "@/lib/uzupro";
import { recordUzuProActivity } from "@/lib/uzupro/activity";

export const dynamic = "force-dynamic";

/** UUID か null のみ許可。空文字は「解除」ではなく入力不正として弾く（誤操作防止）。 */
const bodySchema = z.object({ uzuProjectId: z.string().uuid().nullable() }).strict();

/**
 * 現在の対応関係を取得する（設定画面の表示用）。
 * 返すのは uzuProjectId のみ。権限は PATCH と同じ（owner / platform owner）。
 */
export async function GET(req: NextRequest, { params }: { params: { id: string; workId: string } }) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } }, { status: 401 });
  }
  if (!(await canManageUzuProWork(params.id, user.id))) return forbidden();

  const work = await prisma.work.findFirst({
    where:  { id: params.workId, oaId: params.id },
    select: { uzuProjectId: true },
  });
  if (!work) return notFound("作品");
  return ok({ uzuProjectId: work.uzuProjectId });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; workId: string } }) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } }, { status: 401 });
  }
  // クライアント表示だけの制御にしない: 変更権限をサーバー側で再検証（owner / platform owner のみ）。
  if (!(await canManageUzuProWork(params.id, user.id))) return forbidden();

  try {
    const { uzuProjectId } = bodySchema.parse(await req.json());

    const work = await prisma.work.findFirst({
      where:  { id: params.workId, oaId: params.id },
      select: { id: true, uzuProjectId: true },
    });
    if (!work) return notFound("作品");

    if (work.uzuProjectId === uzuProjectId) {
      return ok({ uzuProjectId, changed: false }); // 冪等・変化なし
    }

    await prisma.work.update({ where: { id: work.id }, data: { uzuProjectId } });
    await recordUzuProActivity(prisma, {
      oaId:        params.id,
      workId:      params.workId,
      actorUserId: user.id,
      action:      uzuProjectId ? "work_project_link_set" : "work_project_link_cleared",
      targetType:  "work",
      targetId:    params.workId,
    });
    return ok({ uzuProjectId, changed: true });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力が不正です");
    return serverError(err);
  }
}
