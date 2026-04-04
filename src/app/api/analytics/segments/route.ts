// src/app/api/analytics/segments/route.ts
// GET /api/analytics/segments?oa_id=xxx&work_id=xxx

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";
const querySchema = z.object({
  oa_id:   z.string().uuid(),
  work_id: z.string().uuid(),
});

function round1(n: number): number { return Math.round(n * 10) / 10; }

function calcPlayMin(createdAt: Date, last: Date): number {
  return Math.max(0, (last.getTime() - createdAt.getTime()) / 60000);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      oa_id:   searchParams.get("oa_id")   ?? undefined,
      work_id: searchParams.get("work_id") ?? undefined,
    });
    if (!parsed.success) return badRequest("クエリパラメータが不正です");
    const { oa_id, work_id } = parsed.data;

    const [oa, work] = await Promise.all([
      prisma.oa.findUnique({ where: { id: oa_id } }),
      prisma.work.findUnique({ where: { id: work_id } }),
    ]);
    if (!oa)   return notFound("OA");
    if (!work) return notFound("作品");

    const [segments, allProgress] = await Promise.all([
      prisma.segment.findMany({ where: { oaId: oa_id }, orderBy: { createdAt: "asc" } }),
      prisma.userProgress.findMany({ where: { workId: work_id } }),
    ]);

    const now          = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dropoutMs    = 24 * 60 * 60 * 1000;

    const results = segments.map((seg) => {
      let matched = allProgress;
      if (seg.filterType === "friend_7d") {
        matched = allProgress.filter((p) => p.createdAt >= sevenDaysAgo);
      } else if (seg.filterType === "inactive_7d") {
        matched = allProgress.filter((p) => !p.reachedEnding && p.lastInteractedAt < sevenDaysAgo);
      } else if (seg.filterType === "phase" && seg.phaseId) {
        matched = allProgress.filter((p) => p.currentPhaseId === seg.phaseId);
      }

      const totalMatched = matched.length;
      const totalClears  = matched.filter((p) => p.reachedEnding).length;
      const clearRate    = totalMatched > 0 ? round1((totalClears / totalMatched) * 100) : 0;
      const playTimes    = matched.map((p) => calcPlayMin(p.createdAt, p.lastInteractedAt));
      const avgPlayTime  = round1(avg(playTimes));
      const dropoutCount = matched.filter(
        (p) => !p.reachedEnding && now.getTime() - p.lastInteractedAt.getTime() >= dropoutMs
      ).length;
      const dropoutRate  = totalMatched > 0 ? round1((dropoutCount / totalMatched) * 100) : 0;

      return {
        segment_id:        seg.id,
        segment_name:      seg.name,
        filter_type:       seg.filterType,
        phase_id:          seg.phaseId,
        status:            seg.status,
        total_matched:     totalMatched,
        total_clears:      totalClears,
        clear_rate:        clearRate,
        avg_play_time_min: avgPlayTime,
        dropout_count:     dropoutCount,
        dropout_rate:      dropoutRate,
      };
    });

    return ok(results);
  } catch (err) {
    return serverError(err);
  }
});
