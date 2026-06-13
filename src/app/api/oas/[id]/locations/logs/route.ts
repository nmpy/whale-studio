// src/app/api/oas/[id]/locations/logs/route.ts
// GET /api/oas/[id]/locations/logs — GPS / QR / Beacon の実行ログを統合（read 専用）。
//
// 正規化方針（二重計上回避）:
//   - GPS/QR 成功 → LocationVisit
//   - GPS/QR 非成功 → CheckinAttempt（status != "success"）
//   - Beacon → BeaconEventLog（全件）
// OA スコープ: GPS/QR は workId IN（OA の全作品）、Beacon は oaId。
// 既存 /api/liff/checkin* / DB / checkin 副作用は一切触らない。片方の取得失敗でも 5xx にしない。
//
// query: workId / type(gps|qr|beacon) / status / from / to / userId / locationId / beaconTriggerId / limit

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import {
  checkinTypeFromMethod, methodsForTypeFilter, type UnifiedLogRow,
} from "@/lib/location-log";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const GET = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    // read 権限は既存 locations と同じく viewer 以上。
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const q = new URL(req.url).searchParams;
    const typeFilter        = q.get("type");                 // "gps" | "qr" | "beacon" | null
    const statusFilter      = q.get("status")?.trim() || null;
    const userId            = q.get("userId")?.trim() || null;
    const locationId        = q.get("locationId")?.trim() || null;
    const beaconTriggerId   = q.get("beaconTriggerId")?.trim() || null;
    const workIdParam       = q.get("workId")?.trim() || null;
    const from = parseDate(q.get("from"));
    const to   = parseDate(q.get("to"));
    const limitRaw = parseInt(q.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    // ── OA の作品 / ロケーション（名前解決 + OA スコープ用） ──
    const works = await prisma.work.findMany({ where: { oaId }, select: { id: true, title: true } });
    let workIds = works.map((w) => w.id);
    if (workIdParam) workIds = workIds.filter((id) => id === workIdParam); // OA 外 workId は無視
    const titleByWork = new Map(works.map((w) => [w.id, w.title]));

    const locs = workIds.length > 0
      ? await prisma.location.findMany({ where: { workId: { in: workIds } }, select: { id: true, name: true, workId: true } })
      : [];
    const nameByLoc = new Map(locs.map((l) => [l.id, l.name]));

    const wantGpsQr  = !typeFilter || typeFilter === "gps" || typeFilter === "qr";
    const wantBeacon = !typeFilter || typeFilter === "beacon";
    const methodIn = (typeFilter === "gps" || typeFilter === "qr") ? methodsForTypeFilter(typeFilter) : null;
    const dateRange = (from || to)
      ? { ...(from && { gte: from }), ...(to && { lte: to }) }
      : null;

    // ── 3 ソースを並列取得（1 つ失敗しても全体は落とさない） ──
    const [visitsR, attemptsR, beaconR] = await Promise.allSettled([
      // GPS/QR 成功（status フィルタが success 以外なら除外）
      (wantGpsQr && workIds.length > 0 && (!statusFilter || statusFilter === "success"))
        ? prisma.locationVisit.findMany({
            where: {
              workId: { in: workIds },
              ...(locationId && { locationId }),
              ...(userId && { lineUserId: { contains: userId } }),
              ...(methodIn && { checkinMethod: { in: methodIn } }),
              ...(dateRange && { visitedAt: dateRange }),
            },
            orderBy: { visitedAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),

      // GPS/QR 非成功（attempt）
      (wantGpsQr && workIds.length > 0 && statusFilter !== "success")
        ? prisma.checkinAttempt.findMany({
            where: {
              workId: { in: workIds },
              status: statusFilter ? statusFilter : { not: "success" },
              ...(locationId && { locationId }),
              ...(userId && { lineUserId: { contains: userId } }),
              ...(methodIn && { method: { in: methodIn } }),
              ...(dateRange && { createdAt: dateRange }),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),

      // Beacon
      wantBeacon
        ? prisma.beaconEventLog.findMany({
            where: {
              oaId,
              ...(workIdParam && { workId: workIdParam }),
              ...(beaconTriggerId && { beaconTriggerId }),
              ...(userId && { lineUserId: { contains: userId } }),
              ...(statusFilter && { actionStatus: statusFilter }),
              ...(dateRange && { createdAt: dateRange }),
            } as Prisma.BeaconEventLogWhereInput,
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    const rows: UnifiedLogRow[] = [];

    if (visitsR.status === "fulfilled") {
      for (const v of visitsR.value) {
        rows.push({
          id: `visit:${v.id}`, source: "visit", ts: v.visitedAt.toISOString(),
          type: checkinTypeFromMethod(v.checkinMethod), outcome: "success",
          work_id: v.workId, work_title: titleByWork.get(v.workId) ?? null,
          point_name: nameByLoc.get(v.locationId) ?? null,
          location_id: v.locationId, beacon_trigger_id: null,
          line_user_id: v.lineUserId, message_id: null, error_message: null,
          is_test: false,
          raw: { distance_meters: v.distanceMeters, checkin_method: v.checkinMethod },
        });
      }
    }

    if (attemptsR.status === "fulfilled") {
      for (const a of attemptsR.value) {
        rows.push({
          id: `attempt:${a.id}`, source: "attempt", ts: a.createdAt.toISOString(),
          type: checkinTypeFromMethod(a.method), outcome: a.status,
          work_id: a.workId, work_title: titleByWork.get(a.workId) ?? null,
          point_name: nameByLoc.get(a.locationId) ?? null,
          location_id: a.locationId, beacon_trigger_id: null,
          line_user_id: a.lineUserId, message_id: null,
          error_message: a.failureReason ?? null, is_test: false,
          raw: { distance_meters: a.distanceMeters, lat: a.lat, lng: a.lng, method: a.method },
        });
      }
    }

    // Beacon 名解決
    if (beaconR.status === "fulfilled" && beaconR.value.length > 0) {
      const trigIds = [...new Set(beaconR.value.map((b) => b.beaconTriggerId).filter((v): v is string => !!v))];
      const trigs = trigIds.length > 0
        ? await prisma.beaconTrigger.findMany({ where: { id: { in: trigIds } }, select: { id: true, name: true } })
        : [];
      const trigName = new Map(trigs.map((t) => [t.id, t.name]));
      for (const b of beaconR.value) {
        rows.push({
          id: `beacon:${b.id}`, source: "beacon", ts: b.createdAt.toISOString(),
          type: "Beacon", outcome: b.actionStatus,
          work_id: b.workId, work_title: b.workId ? (titleByWork.get(b.workId) ?? null) : null,
          point_name: b.beaconTriggerId ? (trigName.get(b.beaconTriggerId) ?? null) : null,
          location_id: null, beacon_trigger_id: b.beaconTriggerId,
          line_user_id: b.lineUserId, message_id: b.messageId,
          error_message: b.errorMessage, is_test: b.isTest,
          raw: b.rawEvent ?? { hwid: b.hwid, beacon_type: b.beaconType, dm: b.deviceMessage },
        });
      }
    }

    // 新しい順にマージして limit 件へ
    rows.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
    const sliced = rows.slice(0, limit);

    return ok(sliced, {
      // 取得不能ソースがあれば UI で注意喚起できるようメタに残す
      sources: {
        visit:   visitsR.status,
        attempt: attemptsR.status,
        beacon:  beaconR.status,
      },
      returned: sliced.length,
      truncated: rows.length > sliced.length,
    });
  } catch (err) {
    return serverError(err);
  }
});
