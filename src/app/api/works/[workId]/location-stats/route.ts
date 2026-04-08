// src/app/api/works/[workId]/location-stats/route.ts
// GET /api/works/:workId/location-stats — 作品のロケーション訪問統計

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import type { LocationVisitStats, LocationVisitSummary } from "@/types";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const oaId = await getOaIdFromWorkId(params.workId);
    if (oaId) {
      const check = await requireRole(oaId, user.id, "viewer");
      if (!check.ok) return check.response;
    }

    const workId = params.workId;

    // ── 総チェックイン数 + ユニークユーザー ──
    const [totalAgg, recentAgg, locations] = await Promise.all([
      prisma.locationVisit.aggregate({
        where: { workId },
        _count: { id: true },
      }),
      prisma.locationVisit.aggregate({
        where: { workId, visitedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        _count: { id: true },
      }),
      prisma.location.findMany({
        where: { workId },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    // ユニークユーザー数（Prisma groupBy で distinct 取得）
    const uniqueUsers = await prisma.locationVisit.groupBy({
      by: ["lineUserId"],
      where: { workId },
    });

    // ロケーション別集計
    const byLocationRaw = await prisma.locationVisit.groupBy({
      by: ["locationId"],
      where: { workId },
      _count: { id: true },
      _max: { visitedAt: true },
    });

    // ロケーション別ユニークユーザー
    const byLocUser = await prisma.locationVisit.groupBy({
      by: ["locationId", "lineUserId"],
      where: { workId },
    });
    const locUserMap = new Map<string, number>();
    for (const row of byLocUser) {
      locUserMap.set(row.locationId, (locUserMap.get(row.locationId) ?? 0) + 1);
    }

    const locMap = new Map(locations.map((l) => [l.id, l.name]));
    const byLocation: LocationVisitSummary[] = byLocationRaw.map((r) => ({
      location_id:    r.locationId,
      location_name:  locMap.get(r.locationId) ?? "不明",
      total_visits:   r._count.id,
      unique_users:   locUserMap.get(r.locationId) ?? 0,
      last_visited_at: r._max.visitedAt?.toISOString() ?? null,
    })).sort((a, b) => b.total_visits - a.total_visits);

    const stats: LocationVisitStats = {
      total_checkins:     totalAgg._count.id,
      unique_users:       uniqueUsers.length,
      location_count:     locations.length,
      recent_7d_checkins: recentAgg._count.id,
      by_location:        byLocation,
    };

    return ok(stats);
  } catch (err) {
    return serverError(err);
  }
});
