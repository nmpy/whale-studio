// src/app/api/works/[workId]/werewolf/slots/[slotId]/cards/reorder/route.ts
//
// POST — slot 配下のカード並び替え。body の card_ids 順で sort_order を 0,1,2... に再採番。
//
// 検証:
//   - 全 card_id が同じ slot に属していること
//   - 渡された card_ids の集合が slot 配下の全カードと完全一致 (= 漏れ / 余剰なし)

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { reorderWerewolfRoleCardsSchema, formatZodErrors } from "@/lib/validations";
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
    const { card_ids } = reorderWerewolfRoleCardsSchema.parse(body);

    // 現在 slot 配下のカード全 ID を取得して、リクエスト集合と一致するか検証
    const current = await prisma.werewolfRoleCard.findMany({
      where:  { slotId },
      select: { id: true },
    });
    const currentSet = new Set(current.map((c) => c.id));
    const requestSet = new Set(card_ids);

    if (currentSet.size !== requestSet.size) {
      return badRequest("並び替えリクエストとカード一覧の件数が一致しません");
    }
    for (const id of card_ids) {
      if (!currentSet.has(id)) {
        return badRequest("並び替えリクエストにこの slot に属さない card_id が含まれています");
      }
    }

    // トランザクションで一括 update。indexed update なので大量カードでも問題なし。
    await prisma.$transaction(
      card_ids.map((id, idx) =>
        prisma.werewolfRoleCard.update({
          where: { id },
          data:  { sortOrder: idx },
        })
      )
    );

    return ok({ slot_id: slotId, card_ids });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});
