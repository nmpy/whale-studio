// src/app/api/works/[workId]/destinations/route.ts
// GET  /api/works/[workId]/destinations — destination 一覧
// POST /api/works/[workId]/destinations — destination 作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, created, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { createDestinationSchema, formatZodErrors } from "@/lib/validations";
import { toDestinationResponse } from "@/lib/destination-utils";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";
import { getDestinationUsageCounts } from "@/lib/destination-usage-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

/** URL 生成用に「対象 OA の Oa.liffId」と「対象 Work の publicId」を 1 回で引く。
 *  destination の resolved_url は運用者がリッチメニューへ保存するため、
 *  LIFF ID は必ず Work → OA → Oa.liffId の経路で解決する（env fallback なし）。
 *  Work は 1 リクエスト内で共通なので、行ごとに引かない（N+1 を作らない）。 */
async function urlContextForWork(workId: string): Promise<{ liffId: string | null; workPublicId: string | null }> {
  const work = await prisma.work.findUnique({
    where:  { id: workId },
    select: { publicId: true, oa: { select: { liffId: true } } },
  });
  return { liffId: getLiffIdForUrlGeneration(work?.oa), workPublicId: work?.publicId ?? null };
}

// ── GET ─────────────────────────────────────────
export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const [destinations, usageCounts, urlCtx] = await Promise.all([
      prisma.lineDestination.findMany({
        where: { workId },
        orderBy: [{ createdAt: "asc" }],
      }),
      getDestinationUsageCounts(workId),
      urlContextForWork(workId),
    ]);

    return ok(destinations.map((d) => ({
      ...toDestinationResponse(d, urlCtx),
      usage_count: usageCounts[d.id] ?? 0,
    })));
  } catch (err) {
    return serverError(err);
  }
});

// ── POST ────────────────────────────────────────
export const POST = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // プラン制限: destinations は Plus プラン以上
    const planGuard = await requirePlanFeature({ oaId, featureKey: FEATURE.destinations });
    if (!planGuard.ok) return planGuard.response;

    const body = await req.json();
    const data = createDestinationSchema.parse({ ...body, work_id: workId });

    // key 重複チェック
    const existing = await prisma.lineDestination.findUnique({
      where: { workId_key: { workId, key: data.key } },
    });
    if (existing) {
      return conflict(`key "${data.key}" はこの作品で既に使われています`);
    }

    const dest = await prisma.lineDestination.create({
      data: {
        workId,
        key:             data.key,
        name:            data.name,
        description:     data.description ?? null,
        destinationType: data.destination_type,
        liffTargetType:  data.liff_target_type ?? null,
        urlOrPath:       data.url_or_path ?? null,
        queryParamsJson: (data.query_params_json ?? {}) as Prisma.InputJsonValue,
        isEnabled:       data.is_enabled ?? true,
      },
    });

    return created(toDestinationResponse(dest, await urlContextForWork(workId)));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
