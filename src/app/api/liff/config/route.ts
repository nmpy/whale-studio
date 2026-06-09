// src/app/api/liff/config/route.ts
//
// GET /api/liff/config — LIFF Runtime 用の公開設定 API（認証なし）。
//
// workId / oaId / pageId / locationId のいずれかから対象 OA を解決し、
// その OA の liffId（Oa.liffId → NEXT_PUBLIC_LIFF_ID フォールバック）と
// 利用可能 feature フラグ（scanQr / gpsCheckin）を返す。
//
// Runtime（/liff 配下のページ）は liff.init({ liffId }) の前にこれを呼んで liffId を解決する想定。
// 他の /api/liff/* と同様に認証なし。lineUserId 等の秘匿情報は扱わない（公開設定のみ）。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { getLiffIdForOa, getLiffIdSource } from "@/lib/liff/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const oaId       = searchParams.get("oaId")       || searchParams.get("oa_id")       || null;
    const workId     = searchParams.get("workId")     || searchParams.get("work_id")     || null;
    const pageId     = searchParams.get("pageId")     || searchParams.get("page_id")     || null;
    const locationId = searchParams.get("locationId") || searchParams.get("location_id") || null;

    if (!oaId && !workId && !pageId && !locationId) {
      return badRequest("oaId / workId / pageId / locationId のいずれかが必要です");
    }

    // 対象 work を解決（feature 判定で gps location を引くため workId も保持する）。
    let resolvedOaId: string | null = oaId;
    let resolvedWorkId: string | null = workId;

    if (!resolvedOaId) {
      if (workId) {
        const w = await prisma.work.findUnique({ where: { id: workId }, select: { oaId: true } });
        resolvedOaId = w?.oaId ?? null;
      } else if (locationId) {
        const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { workId: true, work: { select: { oaId: true } } } });
        resolvedOaId  = loc?.work?.oaId ?? null;
        resolvedWorkId = resolvedWorkId ?? loc?.workId ?? null;
      } else if (pageId) {
        const pg = await prisma.liffPageConfig.findUnique({ where: { id: pageId }, select: { workId: true, work: { select: { oaId: true } } } });
        resolvedOaId  = pg?.work?.oaId ?? null;
        resolvedWorkId = resolvedWorkId ?? pg?.workId ?? null;
      }
    }

    if (!resolvedOaId) return notFound("OA");

    const oa = await prisma.oa.findUnique({
      where:  { id: resolvedOaId },
      select: { id: true, liffId: true, liffScanQrEnabled: true },
    });
    if (!oa) return notFound("OA");

    const liffId = getLiffIdForOa(oa);

    // gpsCheckin: locationId が gpsEnabled、または work に gpsEnabled な active location があれば true。
    let gpsCheckin = false;
    if (locationId) {
      const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { gpsEnabled: true, isActive: true } });
      gpsCheckin = !!(loc?.gpsEnabled && loc.isActive);
    } else if (resolvedWorkId) {
      const cnt = await prisma.location.count({ where: { workId: resolvedWorkId, gpsEnabled: true, isActive: true } });
      gpsCheckin = cnt > 0;
    }

    return ok({
      ok:         true,
      liffId,
      liffIdSource: getLiffIdSource(oa),
      configured: liffId !== null,
      oaId:       oa.id,
      workId:     resolvedWorkId,
      pageId,
      locationId,
      features: {
        scanQr:     oa.liffScanQrEnabled === true,
        gpsCheckin,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
