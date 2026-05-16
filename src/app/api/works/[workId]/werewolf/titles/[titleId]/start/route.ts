// src/app/api/works/[workId]/werewolf/titles/[titleId]/start/route.ts
//
// POST — ゲーム開始 (is_started=true + started_at=now)
//
// 仕様:
//   - 冪等。すでに is_started=true なら 200 でそのまま返す (再押し safe)。
//   - admin 不要、editor 以上で十分。GM 自身がボタンを押す想定。
//   - クライアント側は window.confirm() で確認ダイアログを出してから POST する。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (_req, ctx, user) => {
  try {
    const { workId, titleId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await prisma.werewolfTitle.findUnique({
      where: { id: titleId },
      select: { id: true, workId: true, isStarted: true },
    });
    if (!existing || existing.workId !== workId) return notFound("WerewolfTitle");

    // 冪等: 既に開始済みなら何もせず現状を返す
    if (existing.isStarted) {
      const current = await prisma.werewolfTitle.findUnique({ where: { id: titleId } });
      return ok({
        id:         current!.id,
        is_started: current!.isStarted,
        started_at: current!.startedAt,
      });
    }

    const updated = await prisma.werewolfTitle.update({
      where: { id: titleId },
      data:  { isStarted: true, startedAt: new Date() },
    });

    return ok({
      id:         updated.id,
      is_started: updated.isStarted,
      started_at: updated.startedAt,
    });
  } catch (err) {
    return serverError(err);
  }
});
