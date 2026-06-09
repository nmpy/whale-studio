// src/app/api/oas/[id]/works/[workId]/liff/pages/[pageId]/submissions/route.ts
// GET — LIFF 回答結果（管理画面用）。
//
// 権限: withAuth + requireRole(viewer)。
// テナント分離: pageId 単独では検索せず、必ず oaId / workId と組み合わせて検証する。
//   - work を解決し、その oaId が URL の [id] と一致することを確認（他 OA を弾く）
//   - page が work に属することを workScope で確認
//
// 返却: createdAt desc の submissions + サマリー（総数 / 今日 / 直近7日 / 最終回答日時）。
// pagination: ?limit (既定 500, 最大 2000) / ?offset。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { findWorkByIdOrPublicId, findLiffPageConfigByIdOrPublicId } from "@/lib/public-id-resolver";
import { extractAnswerBlocks } from "@/lib/liff/submission";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string; workId: string; pageId: string }>(async (req, ctx, user) => {
  try {
    const { id: oaIdParam, workId: workIdOrPublic, pageId: pageIdOrPublic } = await ctx.params;

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return notFound("Work");

    const oaId = await getOaIdFromWorkId(work.id);
    if (!oaId || oaId !== oaIdParam) return notFound("Work"); // URL の OA と work の OA 不一致 → 弾く

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const page = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
    if (!page) return notFound("LiffPage");

    const { searchParams } = new URL(req.url);
    const limit  = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

    const where = { oaId, workId: work.id, liffPageId: page.id };

    const [total, rows, agg] = await Promise.all([
      prisma.liffSubmission.count({ where }),
      prisma.liffSubmission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: { id: true, lineUserId: true, displayName: true, answersJson: true, createdAt: true },
      }),
      prisma.liffSubmission.aggregate({ where, _max: { createdAt: true } }),
    ]);

    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const last7dCutoff = now - 7 * 24 * 60 * 60 * 1000;

    const [todayCount, last7dCount] = await Promise.all([
      prisma.liffSubmission.count({ where: { ...where, createdAt: { gte: startOfToday } } }),
      prisma.liffSubmission.count({ where: { ...where, createdAt: { gte: new Date(last7dCutoff) } } }),
    ]);

    return ok({
      page: { id: page.id, public_id: page.publicId, title: page.title },
      total,
      today: todayCount,
      last_7d: last7dCount,
      last_at: agg._max.createdAt ? agg._max.createdAt.toISOString() : null,
      limit,
      offset,
      submissions: rows.map((r) => ({
        id:           r.id,
        line_user_id: r.lineUserId,
        display_name: r.displayName,
        created_at:   r.createdAt.toISOString(),
        blocks:       extractAnswerBlocks(r.answersJson),
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});
