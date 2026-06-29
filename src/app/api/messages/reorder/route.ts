// src/app/api/messages/reorder/route.ts
// PATCH /api/messages/reorder
//
// 一覧画面で「上へ / 下へ」操作を行ったときの一括 sortOrder 更新エンドポイント。
//
// Body:
//   {
//     work_id: string,
//     message_ids: string[]  // = 並び順 (= sortOrder 0, 1, 2, ...)
//   }
//
// 認可: work_id の OA に対して owner 権限が必要。
// 整合性: 渡された message_ids が **すべて同じ work_id に属する** ことを検証する。
//   他 work / OA の messageId を混ぜて更新できないようにする。
//
// 更新は transaction で一括実行 (= 中途半端な状態にならない)。
// 並び替え後、phase 単位のキャッシュを無効化する。

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { activeCache, CACHE_KEY } from "@/lib/cache";

export const dynamic = "force-dynamic";

const reorderSchema = z.object({
  work_id:     z.string().min(1, "work_id は必須です"),
  message_ids: z.array(z.string().min(1)).min(1, "message_ids は 1 件以上必要です"),
});

export const PATCH = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / "));
    }
    const { work_id, message_ids } = parsed.data;

    // 重複チェック
    const uniqueIds = new Set(message_ids);
    if (uniqueIds.size !== message_ids.length) {
      return badRequest("message_ids に重複があります");
    }

    // 認可: 表示順変更は editor 以上に緩和（制作者が並び替えできる）。
    const oaId = await getOaIdFromWorkId(work_id);
    if (!oaId) return badRequest("work_id に該当する作品が見つかりません");
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // 整合性: 渡された ID がすべて該当 work に属することを検証する。
    // 他 work / OA の messageId を混ぜて更新できないようにする (= 権限境界の保証)。
    const found = await prisma.message.findMany({
      where: { id: { in: message_ids }, workId: work_id },
      select: { id: true, phaseId: true, phase: { select: { phaseType: true } } },
    });
    if (found.length !== message_ids.length) {
      return badRequest(
        `指定された message_ids のうち ${message_ids.length - found.length} 件が work=${work_id.slice(0, 8)} に属していません`,
      );
    }

    // transaction で sortOrder を一括更新 (= 中途半端な順序を避ける)
    await prisma.$transaction(
      message_ids.map((id, index) =>
        prisma.message.update({
          where: { id },
          data:  { sortOrder: index },
        }),
      ),
    );

    // 影響を受ける phase のキャッシュを無効化
    const phaseIds = new Set(found.map((m) => m.phaseId).filter((p): p is string => p !== null));
    for (const phaseId of phaseIds) {
      await activeCache.delete(CACHE_KEY.phase(phaseId));
      await activeCache.delete(CACHE_KEY.startMsgs(phaseId));
    }
    // global キーワード (phaseId=null や phase.phaseType=global) もキャッシュ無効化
    const hasGlobal = found.some((m) => m.phaseId === null || m.phase?.phaseType === "global");
    if (hasGlobal) {
      await activeCache.delete(CACHE_KEY.globalKw(work_id));
    }

    return ok({ updated: message_ids.length });
  } catch (err) {
    console.error("[PATCH /api/messages/reorder] UNEXPECTED ERROR:", err);
    return serverError(err);
  }
});
