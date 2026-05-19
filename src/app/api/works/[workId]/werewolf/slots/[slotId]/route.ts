// src/app/api/works/[workId]/werewolf/slots/[slotId]/route.ts
//
// 配役スロット更新 (GM 用)
//   PUT — label のみ。token は別 endpoint (rotate-token) で再発行する。
//   削除は別途必要になったら追加 (現状はタイトル削除に伴う cascade のみ)。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateWerewolfRoleSlotSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId, slotId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // テナント分離: slot → title.workId が workId と一致するかチェック
    const existing = await prisma.werewolfRoleSlot.findUnique({
      where: { id: slotId },
      include: { title: { select: { workId: true } } },
    });
    if (!existing || existing.title.workId !== workId) return notFound("WerewolfRoleSlot");

    const body = await req.json();
    const data = updateWerewolfRoleSlotSchema.parse(body);

    const updated = await prisma.werewolfRoleSlot.update({
      where: { id: slotId },
      data: {
        ...(data.label !== undefined && { label: data.label }),
      },
    });

    return ok({
      id:           updated.id,
      title_id:     updated.titleId,
      slot_number:  updated.slotNumber,
      label:        updated.label,
      token:        updated.token,
      created_at:   updated.createdAt,
      updated_at:   updated.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});
