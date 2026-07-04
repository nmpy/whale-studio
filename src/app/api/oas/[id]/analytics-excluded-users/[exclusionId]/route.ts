// src/app/api/oas/[id]/analytics-excluded-users/[exclusionId]/route.ts
// DELETE /api/oas/:id/analytics-excluded-users/:exclusionId — 除外解除（owner / admin のみ）
//   - 行を物理削除するだけ（UserProgress 等の元データには一切触れない）。
//   - 解除後は次回の分析取得で再び集計に含まれる。
//   - 他 OA の除外行は削除できない（oaId で二重に絞る）。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";

export const DELETE = withRole<{ id: string; exclusionId: string }>(
  ({ params }) => params.id,
  ["admin", "owner"],
  async (_req, { params }) => {
    try {
      // oaId 一致を必須にして他 OA の行を消せないようにする。
      const row = await prisma.analyticsExcludedUser.findFirst({
        where:  { id: params.exclusionId, oaId: params.id },
        select: { id: true },
      });
      if (!row) return notFound("除外設定");

      await prisma.analyticsExcludedUser.delete({ where: { id: row.id } });
      return ok({ id: row.id, deleted: true });
    } catch (err) {
      return serverError(err);
    }
  },
);
