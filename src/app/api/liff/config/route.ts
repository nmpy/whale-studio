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
//
// workId / pageId / locationId は **UUID / publicId のどちらでも**受け付ける。
// LIFF 短縮 URL（/liff/w/[workPublicId]/p/[pagePublicId] や /liff/c/[workPublicId]/[locationPublicId]）は
// publicId しか持たないため、UUID 限定だと OA を解決できず liffId が返せない。
// 他の /api/liff/* と同じ resolver（public-id-resolver）を使って揃える。
//
// 返す値は公開情報のみ（liffId は LIFF URL に露出する公開識別子）。
// channelSecret / channelAccessToken / lineUserId / 個人情報は**返さない**。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { getLiffIdForOa, getLiffIdSource } from "@/lib/liff/config";
import {
  findWorkByIdOrPublicId,
  findLiffPageConfigByIdOrPublicId,
  findLocationByIdOrPublicId,
} from "@/lib/public-id-resolver";

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
    // workId / pageId / locationId は UUID / publicId の両方を受け付ける。
    // resolvedWorkId / resolvedLocation は以降の DB 参照で使うため **必ず UUID 実体**に正規化する。
    let resolvedOaId: string | null = oaId;
    let resolvedWorkId: string | null = null;
    let resolvedLocation: { id: string; workId: string; gpsEnabled: boolean; isActive: boolean } | null = null;

    if (workId) {
      const w = await findWorkByIdOrPublicId(workId);
      resolvedWorkId = w?.id ?? null;
      if (!resolvedOaId) resolvedOaId = w?.oaId ?? null;
    }

    if (locationId) {
      const loc = await findLocationByIdOrPublicId(locationId);
      if (loc) {
        resolvedLocation = { id: loc.id, workId: loc.workId, gpsEnabled: loc.gpsEnabled, isActive: loc.isActive };
        resolvedWorkId = resolvedWorkId ?? loc.workId;
      }
    }

    if (pageId && (!resolvedOaId || !resolvedWorkId)) {
      const pg = await findLiffPageConfigByIdOrPublicId(pageId);
      if (pg) resolvedWorkId = resolvedWorkId ?? pg.workId;
    }

    // ここまでで OA が未確定なら、確定した workId から引く（location / page 経由の場合）。
    if (!resolvedOaId && resolvedWorkId) {
      const w = await prisma.work.findUnique({ where: { id: resolvedWorkId }, select: { oaId: true } });
      resolvedOaId = w?.oaId ?? null;
    }

    if (!resolvedOaId) return notFound("OA");

    const oa = await prisma.oa.findUnique({
      where:  { id: resolvedOaId },
      select: { id: true, liffId: true, liffScanQrEnabled: true },
    });
    if (!oa) return notFound("OA");

    const liffId = getLiffIdForOa(oa);

    // gpsCheckin: locationId が gpsEnabled、または work に gpsEnabled な active location があれば true。
    // location は上で UUID / publicId を解決済み（resolvedLocation）なので再取得しない。
    let gpsCheckin = false;
    if (locationId) {
      gpsCheckin = !!(resolvedLocation?.gpsEnabled && resolvedLocation.isActive);
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
