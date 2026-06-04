// src/app/api/oas/[id]/live/actors/[actorId]/route.ts
// PATCH  /api/oas/:id/live/actors/:actorId — 演者名 / 役柄 / memo / userId を更新
// DELETE /api/oas/:id/live/actors/:actorId — 演者削除 (= cascade で invite / assignment も削除)
//
// 認可: live admin 集合 (= authorizeLive)
// Phase 2-J: Admin の演者管理タブから演者編集を行うための CRUD。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const updateActorSchema = z.object({
  display_name:   z.string().min(1).max(120).optional(),
  character_name: z.string().max(120).optional().nullable(),
  memo:           z.string().max(2000).optional().nullable(),
  /// userId の解除 (= null セット) のみ許可。新規紐付けは招待 URL 受諾フローで行う。
  user_id:        z.literal(null).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; actorId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const actor = await prisma.liveActor.findFirst({
      where:  { id: params.actorId, oaId: params.id },
      select: { id: true },
    });
    if (!actor) return notFound("Actor が見つかりません");

    const data = updateActorSchema.parse(await req.json());
    const updated = await prisma.liveActor.update({
      where: { id: params.actorId },
      data: {
        ...(data.display_name   !== undefined && { displayName:   data.display_name   }),
        ...(data.character_name !== undefined && { characterName: data.character_name }),
        ...(data.memo           !== undefined && { memo:          data.memo           }),
        ...(data.user_id        !== undefined && { userId:        data.user_id        }),
      },
    });
    return ok({
      id:             updated.id,
      oa_id:          updated.oaId,
      display_name:   updated.displayName,
      user_id:        updated.userId,
      character_name: updated.characterName,
      memo:           updated.memo,
      created_at:     updated.createdAt,
      updated_at:     updated.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; actorId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const actor = await prisma.liveActor.findFirst({
      where:  { id: params.actorId, oaId: params.id },
      select: { id: true },
    });
    if (!actor) return notFound("Actor が見つかりません");

    await prisma.liveActor.delete({ where: { id: params.actorId } });
    return ok({ ok: true });
  } catch (err) {
    return serverError(err);
  }
}
