// src/app/api/works/[workId]/werewolf/slots/[slotId]/rotate-token/route.ts
//
// POST — slot.token を再発行する。
//
// 使い所:
//   - 印刷 QR を間違えて配布した / 紙が他人の手に渡ったとき
//   - GM が「もう一度違う token で配り直したい」とき
//
// 仕様:
//   - 新 token は PG 関数 gen_unique_public_id() で再採番
//   - 旧 token は即無効化される (Unique 制約で 1 slot に 1 token)
//   - editor 以上が必要

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (_req, ctx, user) => {
  try {
    const { workId, slotId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await prisma.werewolfRoleSlot.findUnique({
      where: { id: slotId },
      include: { title: { select: { workId: true } } },
    });
    if (!existing || existing.title.workId !== workId) return notFound("WerewolfRoleSlot");

    // 新 token を発番する SQL: gen_unique_public_id('werewolf_role_slots')。
    // raw query で UPDATE して RETURNING で新 token を取得。
    const [updated] = await prisma.$queryRawUnsafe<Array<{
      id: string; title_id: string; slot_number: number;
      label: string | null; token: string;
      created_at: Date; updated_at: Date;
    }>>(
      `UPDATE "werewolf_role_slots"
         SET "token" = gen_unique_public_id('werewolf_role_slots'::text),
             "updated_at" = NOW()
       WHERE "id" = $1
       RETURNING "id", "title_id", "slot_number", "label", "token", "created_at", "updated_at"`,
      slotId,
    );

    return ok({
      id:          updated.id,
      title_id:    updated.title_id,
      slot_number: updated.slot_number,
      label:       updated.label,
      token:       updated.token,
      created_at:  updated.created_at,
      updated_at:  updated.updated_at,
    });
  } catch (err) {
    return serverError(err);
  }
});
