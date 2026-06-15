// GET /api/works/:workId/pre-publish-check — 公開前チェック結果（参照のみ）
//
// 設定漏れ・導線切れ・権限不整合を集計して返す。判定ロジックは src/lib/pre-publish-check.ts に分離。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { runPrePublishCheck } from "@/lib/pre-publish-check";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const { workId } = params;
    const work = await prisma.work.findUnique({ where: { id: workId }, select: { oaId: true } });
    if (!work) return notFound("作品");

    const check = await requireRole(work.oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const result = await runPrePublishCheck(workId);
    if (!result) return notFound("作品");
    return ok(result);
  } catch (err) {
    return serverError(err);
  }
});
