// src/app/api/liff/location-info/route.ts
// GET /api/liff/location-info?location_id=xxx — LIFF 用ロケーション公開情報（認証不要）
// checkin_mode を返す（LIFF UI の出し分けに使用）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const locationId = new URL(req.url).searchParams.get("location_id");
    if (!locationId) return badRequest("location_id は必須です");

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, checkinMode: true, isActive: true },
    });
    if (!location) return notFound("ロケーション");

    return ok({
      id:           location.id,
      name:         location.name,
      checkin_mode: location.checkinMode,
      is_active:    location.isActive,
    });
  } catch (err) {
    return serverError(err);
  }
}
