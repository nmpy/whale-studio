// src/app/api/works/[workId]/werewolf/titles/[titleId]/route.ts
//
// Phase 1: 削除のみ。詳細取得・更新・ゲーム開始は Phase 2 で追加する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { noContent, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// ── DELETE /api/works/[workId]/werewolf/titles/[titleId] ────────────────
// 関連する slot / card は ON DELETE CASCADE で自動的に消える。
export const DELETE = withAuth(async (_req, ctx, user) => {
  try {
    const { workId, titleId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await prisma.werewolfTitle.findUnique({
      where: { id: titleId },
      select: { id: true, workId: true },
    });
    if (!existing || existing.workId !== workId) return notFound("WerewolfTitle");

    await prisma.werewolfTitle.delete({ where: { id: titleId } });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
