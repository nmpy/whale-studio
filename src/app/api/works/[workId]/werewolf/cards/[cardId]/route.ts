// src/app/api/works/[workId]/werewolf/cards/[cardId]/route.ts
//
// 配役カード更新 / 削除 (GM 用)。
//
// テナント分離: card → slot → title.workId が workId と一致するか検証する。

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateWerewolfRoleCardSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

async function loadCardWithTenant(cardId: string) {
  return prisma.werewolfRoleCard.findUnique({
    where: { id: cardId },
    include: { slot: { include: { title: { select: { workId: true } } } } },
  });
}

// ── PUT /api/works/[workId]/werewolf/cards/[cardId] ─────────────────────
export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId, cardId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await loadCardWithTenant(cardId);
    if (!existing || existing.slot.title.workId !== workId) return notFound("WerewolfRoleCard");

    const body = await req.json();
    const data = updateWerewolfRoleCardSchema.parse(body);

    const updated = await prisma.werewolfRoleCard.update({
      where: { id: cardId },
      data: {
        ...(data.title       !== undefined && { title:      data.title }),
        ...(data.subtitle    !== undefined && { subtitle:   data.subtitle }),
        ...(data.badge_label !== undefined && { badgeLabel: data.badge_label }),
        ...(data.body        !== undefined && { body:       data.body }),
      },
    });

    return ok({
      id:          updated.id,
      slot_id:     updated.slotId,
      title:       updated.title,
      subtitle:    updated.subtitle,
      badge_label: updated.badgeLabel,
      body:        updated.body,
      sort_order:  updated.sortOrder,
      created_at:  updated.createdAt,
      updated_at:  updated.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/works/[workId]/werewolf/cards/[cardId] ──────────────────
export const DELETE = withAuth(async (_req, ctx, user) => {
  try {
    const { workId, cardId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await loadCardWithTenant(cardId);
    if (!existing || existing.slot.title.workId !== workId) return notFound("WerewolfRoleCard");

    await prisma.werewolfRoleCard.delete({ where: { id: cardId } });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
