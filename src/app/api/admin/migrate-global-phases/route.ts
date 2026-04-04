// src/app/api/admin/migrate-global-phases/route.ts
// POST — 既存作品に globalPhase を作成し、phaseId=null のメッセージを移行する
// 管理者のみ実行可能（owner 以上）

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { activeCache, CACHE_KEY } from "@/lib/cache";

export const POST = withAuth(async (_req, _ctx, _user) => {
  try {
    const works = await prisma.work.findMany({ select: { id: true } });

    const results: { workId: string; created: boolean; migrated: number }[] = [];

    for (const work of works) {
      // global フェーズが既に存在するか確認
      let globalPhase = await prisma.phase.findFirst({
        where: { workId: work.id, phaseType: "global" },
        select: { id: true },
      });

      let created = false;
      if (!globalPhase) {
        globalPhase = await prisma.phase.create({
          data: {
            workId:      work.id,
            phaseType:   "global",
            name:        "全フェーズ共通",
            description: "どのフェーズでも反応するメッセージ（ヒント・ヘルプ等）",
            sortOrder:   -1,
            isActive:    true,
          },
          select: { id: true },
        });
        created = true;
      }

      // phaseId=null のメッセージを global フェーズに移行
      const { count } = await prisma.message.updateMany({
        where: { workId: work.id, phaseId: null },
        data:  { phaseId: globalPhase.id },
      });

      // キャッシュ無効化
      if (created || count > 0) {
        await activeCache.delete(CACHE_KEY.globalKw(work.id));
      }

      results.push({ workId: work.id, created, migrated: count });
    }

    return ok({
      message: "移行完了",
      works:   results.length,
      results,
    });
  } catch (err) {
    return serverError(err);
  }
});
