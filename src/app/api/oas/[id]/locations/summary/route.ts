// src/app/api/oas/[id]/locations/summary/route.ts
// GET /api/oas/[id]/locations/summary — ロケーション運用の集計（read 専用）。
//
// 集計値（二重計上回避）:
//   - GPS/QR 成功 = LocationVisit, GPS/QR 非成功 = CheckinAttempt(status != "success"), Beacon = BeaconEventLog
//   - 「今日」は JST 基準（JST 00:00 以降）。
// 既存 DB / checkin 副作用は触らない。個々の集計が失敗しても全体は 5xx にせず該当値 null。

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** JST の本日 00:00 を表す UTC インスタント。 */
function jstStartOfToday(now: Date): Date {
  const jstDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD"（JST）
  return new Date(`${jstDate}T00:00:00+09:00`);
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const now = new Date();
    const jstStart = jstStartOfToday(now);
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const works = await safe(prisma.work.findMany({ where: { oaId }, select: { id: true } }), [] as { id: string }[]);
    const workIds = works.map((w) => w.id);
    const hasWorks = workIds.length > 0;

    const GPS_MODES = ["gps_only", "qr_and_gps"];
    const QR_MODES = ["qr_only", "qr_and_gps"];

    const [
      locationCount, gpsPointCount, qrPointCount, beaconTriggerCount,
      todaySuccessCount, todayFailedAttemptCount, todayBeaconEventCount,
      last24hSuccessCount, last24hFailedCount, last24hBeaconSentCount,
      lastVisit, lastAttempt, lastBeacon,
    ] = await Promise.all([
      safe(prisma.location.count({ where: { work: { oaId } } }), 0),
      safe(prisma.location.count({ where: { work: { oaId }, checkinMode: { in: GPS_MODES } } }), 0),
      safe(prisma.location.count({ where: { work: { oaId }, checkinMode: { in: QR_MODES } } }), 0),
      safe(prisma.beaconTrigger.count({ where: { oaId } }), 0),

      hasWorks ? safe(prisma.locationVisit.count({ where: { workId: { in: workIds }, visitedAt: { gte: jstStart } } }), 0) : Promise.resolve(0),
      hasWorks ? safe(prisma.checkinAttempt.count({ where: { workId: { in: workIds }, status: { not: "success" }, createdAt: { gte: jstStart } } }), 0) : Promise.resolve(0),
      safe(prisma.beaconEventLog.count({ where: { oaId, createdAt: { gte: jstStart } } }), 0),

      hasWorks ? safe(prisma.locationVisit.count({ where: { workId: { in: workIds }, visitedAt: { gte: since24h } } }), 0) : Promise.resolve(0),
      hasWorks ? safe(prisma.checkinAttempt.count({ where: { workId: { in: workIds }, status: { not: "success" }, createdAt: { gte: since24h } } }), 0) : Promise.resolve(0),
      safe(prisma.beaconEventLog.count({ where: { oaId, actionStatus: "sent", createdAt: { gte: since24h } } }), 0),

      hasWorks ? safe(prisma.locationVisit.findFirst({ where: { workId: { in: workIds } }, orderBy: { visitedAt: "desc" }, select: { visitedAt: true } }), null) : Promise.resolve(null),
      hasWorks ? safe(prisma.checkinAttempt.findFirst({ where: { workId: { in: workIds } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }), null) : Promise.resolve(null),
      safe(prisma.beaconEventLog.findFirst({ where: { oaId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }), null),
    ]);

    const times = [lastVisit?.visitedAt, lastAttempt?.createdAt, lastBeacon?.createdAt].filter((d): d is Date => !!d);
    const lastEventAt = times.length > 0 ? new Date(Math.max(...times.map((d) => d.getTime()))).toISOString() : null;

    return ok({
      locationCount,
      gpsPointCount,
      qrPointCount,
      beaconTriggerCount,
      todaySuccessCount,
      todayFailedAttemptCount,
      todayBeaconEventCount,
      last24hSuccessCount,
      last24hFailedCount,
      last24hBeaconSentCount,
      lastEventAt,
    });
  } catch (err) {
    return serverError(err);
  }
});
