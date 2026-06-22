// src/app/api/oas/[id]/works/[workId]/scheduled-messages/route.ts
// GET /api/oas/:id/works/:workId/scheduled-messages — 予約送信レコードの一覧（最新100件・viewer 以上）。
//   PR-3: 予約の確認用（読み取り専用）。実 push 送信・cron は PR-4。LINE API / channelAccessToken は使わない。
//   他 OA / 他 Work の予約は参照できない（withRole で OA スコープ + work.oaId 一致を検証）。

import { withRole } from "@/lib/auth";
import { ok, serverError, notFound, forbidden } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const GET = withRole<{ id: string; workId: string }>(
  ({ params }) => params.id,
  "viewer",
  async (_req, { params }) => {
    try {
      // Work が当該 OA に属することを検証（他 OA の workId を渡されても参照させない）。
      const work = await prisma.work.findUnique({ where: { id: params.workId }, select: { id: true, oaId: true } });
      if (!work) return notFound("作品が見つかりません");
      if (work.oaId !== params.id) return forbidden();

      const rows = await prisma.scheduledLineMessage.findMany({
        where:   { workId: params.workId },
        orderBy: { dueAt: "asc" },
        take:    100,
        // 機密は含めない（channelAccessToken 等は元々このテーブルに無い）。
        select: {
          id: true, status: true, triggerType: true, triggerEventId: true,
          lineUserId: true, phaseId: true, sourceMessageId: true,
          dueAt: true, createdAt: true, canceledAt: true, sentAt: true,
          retryCount: true, lastError: true,
        },
      });
      return ok({ scheduledMessages: rows });
    } catch (err) {
      return serverError(err);
    }
  },
);
