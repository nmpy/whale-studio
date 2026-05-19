// src/app/api/works/[workId]/werewolf/slots/[slotId]/cards/route.ts
//
// POST — slot 配下に新規カードを追加 (末尾)。
//
// 並び替え endpoint は別ファイル (.../cards/reorder/route.ts)。

import { prisma } from "@/lib/prisma";
import { created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createWerewolfRoleCardSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, ctx, user) => {
  try {
    const { workId, slotId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const slot = await prisma.werewolfRoleSlot.findUnique({
      where: { id: slotId },
      include: { title: { select: { workId: true } } },
    });
    if (!slot || slot.title.workId !== workId) return notFound("WerewolfRoleSlot");

    const body = await req.json();
    const data = createWerewolfRoleCardSchema.parse(body);

    // 末尾に追加するため、現在の最大 sort_order を取得して +1
    const maxOrder = await prisma.werewolfRoleCard.aggregate({
      where: { slotId },
      _max:  { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const card = await prisma.werewolfRoleCard.create({
      data: {
        slotId,
        title:      data.title,
        subtitle:   data.subtitle ?? null,
        badgeLabel: data.badge_label ?? null,
        body:       data.body,
        sortOrder:  nextOrder,
      },
    });

    return created({
      id:          card.id,
      slot_id:     card.slotId,
      title:       card.title,
      subtitle:    card.subtitle,
      badge_label: card.badgeLabel,
      body:        card.body,
      sort_order:  card.sortOrder,
      created_at:  card.createdAt,
      updated_at:  card.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});
