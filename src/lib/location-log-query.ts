// src/lib/location-log-query.ts
// 統合ロケーションログの取得 + 正規化（server 専用 / prisma 使用）。
//
// /api/oas/[id]/locations/logs（一覧）と /logs/export（CSV）の両方から再利用する。
// 正規化方針（二重計上回避）:
//   GPS/QR 成功 → LocationVisit / GPS/QR 非成功 → CheckinAttempt(status != "success") / Beacon → BeaconEventLog
// 既存 /api/liff/checkin* / DB / checkin 副作用は触らない（read 専用）。

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { checkinTypeFromMethod, methodsForTypeFilter, type UnifiedLogRow } from "@/lib/location-log";

export type UnifiedLogFilters = {
  workId?: string | null;
  type?: string | null;          // "gps" | "qr" | "beacon"
  status?: string | null;
  userId?: string | null;
  locationId?: string | null;
  beaconTriggerId?: string | null;
  from?: Date | null;
  to?: Date | null;
};

export type UnifiedLogResult = {
  rows: UnifiedLogRow[];
  sources: { visit: string; attempt: string; beacon: string };
  truncated: boolean;
};

function clampDetail(s: string): string {
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** 統合ログを取得して新しい順に limit 件返す。1 ソース失敗でも全体は落とさない。 */
export async function fetchUnifiedLogs(oaId: string, f: UnifiedLogFilters, limit: number): Promise<UnifiedLogResult> {
  // OA の作品 / ロケーション（名前解決 + OA スコープ）
  const works = await prisma.work.findMany({ where: { oaId }, select: { id: true, title: true } });
  let workIds = works.map((w) => w.id);
  if (f.workId) workIds = workIds.filter((id) => id === f.workId); // OA 外 workId は無視
  const titleByWork = new Map(works.map((w) => [w.id, w.title]));

  const locs = workIds.length > 0
    ? await prisma.location.findMany({ where: { workId: { in: workIds } }, select: { id: true, name: true } })
    : [];
  const nameByLoc = new Map(locs.map((l) => [l.id, l.name]));

  const typeFilter = f.type ?? null;
  const wantGpsQr  = !typeFilter || typeFilter === "gps" || typeFilter === "qr";
  const wantBeacon = !typeFilter || typeFilter === "beacon";
  const methodIn = (typeFilter === "gps" || typeFilter === "qr") ? methodsForTypeFilter(typeFilter) : null;
  const dateRange = (f.from || f.to) ? { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } : null;
  const statusFilter = f.status ?? null;

  const [visitsR, attemptsR, beaconR] = await Promise.allSettled([
    (wantGpsQr && workIds.length > 0 && (!statusFilter || statusFilter === "success"))
      ? prisma.locationVisit.findMany({
          where: {
            workId: { in: workIds },
            ...(f.locationId && { locationId: f.locationId }),
            ...(f.userId && { lineUserId: { contains: f.userId } }),
            ...(methodIn && { checkinMethod: { in: methodIn } }),
            ...(dateRange && { visitedAt: dateRange }),
          },
          orderBy: { visitedAt: "desc" }, take: limit,
        })
      : Promise.resolve([]),

    (wantGpsQr && workIds.length > 0 && statusFilter !== "success")
      ? prisma.checkinAttempt.findMany({
          where: {
            workId: { in: workIds },
            status: statusFilter ? statusFilter : { not: "success" },
            ...(f.locationId && { locationId: f.locationId }),
            ...(f.userId && { lineUserId: { contains: f.userId } }),
            ...(methodIn && { method: { in: methodIn } }),
            ...(dateRange && { createdAt: dateRange }),
          },
          orderBy: { createdAt: "desc" }, take: limit,
        })
      : Promise.resolve([]),

    wantBeacon
      ? prisma.beaconEventLog.findMany({
          where: {
            oaId,
            ...(f.workId && { workId: f.workId }),
            ...(f.beaconTriggerId && { beaconTriggerId: f.beaconTriggerId }),
            ...(f.userId && { lineUserId: { contains: f.userId } }),
            ...(statusFilter && { actionStatus: statusFilter }),
            ...(dateRange && { createdAt: dateRange }),
          } as Prisma.BeaconEventLogWhereInput,
          orderBy: { createdAt: "desc" }, take: limit,
        })
      : Promise.resolve([]),
  ]);

  const rows: UnifiedLogRow[] = [];

  if (visitsR.status === "fulfilled") {
    for (const v of visitsR.value) {
      const dist = v.distanceMeters != null ? `dist=${Math.round(v.distanceMeters)}m ` : "";
      rows.push({
        id: `visit:${v.id}`, source: "visit", ts: v.visitedAt.toISOString(),
        type: checkinTypeFromMethod(v.checkinMethod), outcome: "success",
        work_id: v.workId, work_title: titleByWork.get(v.workId) ?? null,
        point_name: nameByLoc.get(v.locationId) ?? null,
        location_id: v.locationId, beacon_trigger_id: null,
        line_user_id: v.lineUserId, message_id: null, error_message: null, is_test: false,
        detail: clampDetail(`${dist}method=${v.checkinMethod}`),
        raw: { distance_meters: v.distanceMeters, checkin_method: v.checkinMethod },
      });
    }
  }

  if (attemptsR.status === "fulfilled") {
    for (const a of attemptsR.value) {
      const dist = a.distanceMeters != null ? `dist=${Math.round(a.distanceMeters)}m ` : "";
      rows.push({
        id: `attempt:${a.id}`, source: "attempt", ts: a.createdAt.toISOString(),
        type: checkinTypeFromMethod(a.method), outcome: a.status,
        work_id: a.workId, work_title: titleByWork.get(a.workId) ?? null,
        point_name: nameByLoc.get(a.locationId) ?? null,
        location_id: a.locationId, beacon_trigger_id: null,
        line_user_id: a.lineUserId, message_id: null,
        error_message: a.failureReason ?? null, is_test: false,
        detail: clampDetail(`${dist}method=${a.method}`),
        raw: { distance_meters: a.distanceMeters, lat: a.lat, lng: a.lng, method: a.method },
      });
    }
  }

  if (beaconR.status === "fulfilled" && beaconR.value.length > 0) {
    const trigIds = [...new Set(beaconR.value.map((b) => b.beaconTriggerId).filter((v): v is string => !!v))];
    const trigs = trigIds.length > 0
      ? await prisma.beaconTrigger.findMany({ where: { id: { in: trigIds } }, select: { id: true, name: true } })
      : [];
    const trigName = new Map(trigs.map((t) => [t.id, t.name]));
    for (const b of beaconR.value) {
      const dm = b.deviceMessage ? ` dm=${b.deviceMessage.slice(0, 40)}` : "";
      rows.push({
        id: `beacon:${b.id}`, source: "beacon", ts: b.createdAt.toISOString(),
        type: "Beacon", outcome: b.actionStatus,
        work_id: b.workId, work_title: b.workId ? (titleByWork.get(b.workId) ?? null) : null,
        point_name: b.beaconTriggerId ? (trigName.get(b.beaconTriggerId) ?? null) : null,
        location_id: null, beacon_trigger_id: b.beaconTriggerId,
        line_user_id: b.lineUserId, message_id: b.messageId,
        error_message: b.errorMessage, is_test: b.isTest,
        detail: clampDetail(`hwid=${b.hwid} type=${b.beaconType}${dm}`),
        raw: b.rawEvent ?? { hwid: b.hwid, beacon_type: b.beaconType, dm: b.deviceMessage },
      });
    }
  }

  rows.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  const sliced = rows.slice(0, limit);
  return {
    rows: sliced,
    sources: { visit: visitsR.status, attempt: attemptsR.status, beacon: beaconR.status },
    truncated: rows.length > sliced.length,
  };
}
