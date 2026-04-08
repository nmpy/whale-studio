// src/app/api/works/[workId]/location-stats/route.ts
// GET /api/works/:workId/location-stats — 作品のロケーション訪問統計
// checkin_method 別内訳 + GPS 距離統計 + GPS 試行成功率

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import type {
  LocationVisitStats, LocationVisitSummary,
  CheckinMethodBreakdown, GpsDistanceStats,
  GpsAttemptStats, GpsFailureBreakdown,
} from "@/types";

export const dynamic = "force-dynamic";

const FAILURE_STATUSES = [
  "out_of_range", "permission_denied", "gps_unavailable",
  "invalid_request", "location_not_supported", "location_config_incomplete",
  "timeout", "unknown_error",
] as const;

export const GET = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const oaId = await getOaIdFromWorkId(params.workId);
    if (oaId) {
      const check = await requireRole(oaId, user.id, "viewer");
      if (!check.ok) return check.response;
    }

    const workId = params.workId;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // ── 並列クエリ ──
    const [
      totalAgg, recentAgg, locations, uniqueUserRows,
      methodRows, gpsDistAgg,
      byLocationRows, byLocUserRows, byLocMethodRows, byLocGpsRows,
      // GPS 試行ログ
      attemptStatusRows, attemptByLocRows,
    ] = await Promise.all([
      prisma.locationVisit.aggregate({ where: { workId }, _count: { id: true } }),
      prisma.locationVisit.aggregate({ where: { workId, visitedAt: { gte: sevenDaysAgo } }, _count: { id: true } }),
      prisma.location.findMany({ where: { workId }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.locationVisit.groupBy({ by: ["lineUserId"], where: { workId } }),
      prisma.locationVisit.groupBy({ by: ["checkinMethod"], where: { workId }, _count: { id: true } }),
      prisma.locationVisit.aggregate({
        where: { workId, distanceMeters: { not: null } },
        _avg: { distanceMeters: true }, _min: { distanceMeters: true }, _max: { distanceMeters: true }, _count: { distanceMeters: true },
      }),
      prisma.locationVisit.groupBy({ by: ["locationId"], where: { workId }, _count: { id: true }, _max: { visitedAt: true } }),
      prisma.locationVisit.groupBy({ by: ["locationId", "lineUserId"], where: { workId } }),
      prisma.locationVisit.groupBy({ by: ["locationId", "checkinMethod"], where: { workId }, _count: { id: true } }),
      prisma.locationVisit.groupBy({ by: ["locationId"], where: { workId, distanceMeters: { not: null } }, _avg: { distanceMeters: true } }),
      // GPS 試行: status 別件数
      prisma.checkinAttempt.groupBy({ by: ["status"], where: { workId }, _count: { id: true } }),
      // GPS 試行: ロケーション別
      prisma.checkinAttempt.groupBy({ by: ["locationId", "status"], where: { workId }, _count: { id: true } }),
    ]);

    // ── method 内訳 ──
    const methodMap = new Map(methodRows.map((r) => [r.checkinMethod, r._count.id]));
    const methodBreakdown: CheckinMethodBreakdown = {
      qr_count:  methodMap.get("qr") ?? 0,
      gps_count: methodMap.get("gps") ?? 0,
    };

    // ── GPS 距離統計 ──
    const gpsSampleCount = gpsDistAgg._count.distanceMeters;
    const gpsDistance: GpsDistanceStats | null = gpsSampleCount > 0 ? {
      sample_count: gpsSampleCount,
      avg_distance_meters: Math.round(gpsDistAgg._avg.distanceMeters ?? 0),
      min_distance_meters: Math.round(gpsDistAgg._min.distanceMeters ?? 0),
      max_distance_meters: Math.round(gpsDistAgg._max.distanceMeters ?? 0),
    } : null;

    // ── GPS 試行統計 ──
    const attemptMap = new Map(attemptStatusRows.map((r) => [r.status, r._count.id]));
    const gpsSuccesses = attemptMap.get("success") ?? 0;
    const totalAttempts = attemptStatusRows.reduce((sum, r) => sum + r._count.id, 0);
    const gpsFailures = totalAttempts - gpsSuccesses;

    const failureBreakdown: GpsFailureBreakdown = {
      out_of_range:              attemptMap.get("out_of_range") ?? 0,
      permission_denied:         attemptMap.get("permission_denied") ?? 0,
      gps_unavailable:           attemptMap.get("gps_unavailable") ?? 0,
      invalid_request:           attemptMap.get("invalid_request") ?? 0,
      location_not_supported:    attemptMap.get("location_not_supported") ?? 0,
      location_config_incomplete: attemptMap.get("location_config_incomplete") ?? 0,
    };

    const gpsAttempts: GpsAttemptStats = {
      total_attempts: totalAttempts,
      successes:      gpsSuccesses,
      failures:       gpsFailures,
      success_rate:   totalAttempts > 0 ? Math.round((gpsSuccesses / totalAttempts) * 1000) / 10 : null,
      failure_breakdown: failureBreakdown,
    };

    // ── ロケーション別 ──
    const locMap = new Map(locations.map((l) => [l.id, l.name]));
    const locUserMap = new Map<string, number>();
    for (const row of byLocUserRows) locUserMap.set(row.locationId, (locUserMap.get(row.locationId) ?? 0) + 1);

    const locMethodMap = new Map<string, { qr: number; gps: number }>();
    for (const row of byLocMethodRows) {
      const cur = locMethodMap.get(row.locationId) ?? { qr: 0, gps: 0 };
      if (row.checkinMethod === "qr") cur.qr = row._count.id;
      else if (row.checkinMethod === "gps") cur.gps = row._count.id;
      locMethodMap.set(row.locationId, cur);
    }

    const locGpsMap = new Map(byLocGpsRows.map((r) => [r.locationId, r._avg.distanceMeters]));

    // ロケーション別 GPS 試行
    const locAttemptMap = new Map<string, { total: number; success: number }>();
    for (const row of attemptByLocRows) {
      const cur = locAttemptMap.get(row.locationId) ?? { total: 0, success: 0 };
      cur.total += row._count.id;
      if (row.status === "success") cur.success += row._count.id;
      locAttemptMap.set(row.locationId, cur);
    }

    const byLocation: LocationVisitSummary[] = byLocationRows
      .map((r) => {
        const methods = locMethodMap.get(r.locationId) ?? { qr: 0, gps: 0 };
        const avgDist = locGpsMap.get(r.locationId);
        const locAttempt = locAttemptMap.get(r.locationId);
        const locAttemptTotal = locAttempt?.total ?? 0;
        const locAttemptSuccess = locAttempt?.success ?? 0;
        return {
          location_id:         r.locationId,
          location_name:       locMap.get(r.locationId) ?? "不明",
          total_visits:        r._count.id,
          unique_users:        locUserMap.get(r.locationId) ?? 0,
          qr_count:            methods.qr,
          gps_count:           methods.gps,
          avg_distance_meters: avgDist != null ? Math.round(avgDist) : null,
          gps_attempts:        locAttemptTotal,
          gps_successes:       locAttemptSuccess,
          gps_success_rate:    locAttemptTotal > 0 ? Math.round((locAttemptSuccess / locAttemptTotal) * 1000) / 10 : null,
          last_visited_at:     r._max.visitedAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.total_visits - a.total_visits);

    const stats: LocationVisitStats = {
      total_checkins:     totalAgg._count.id,
      unique_users:       uniqueUserRows.length,
      location_count:     locations.length,
      recent_7d_checkins: recentAgg._count.id,
      method_breakdown:   methodBreakdown,
      gps_distance:       gpsDistance,
      gps_attempts:       gpsAttempts,
      by_location:        byLocation,
    };

    return ok(stats);
  } catch (err) {
    return serverError(err);
  }
});
