// src/app/api/liff/location-info/route.ts
// GET /api/liff/location-info?location_id=xxx — LIFF 用ロケーション公開情報（認証不要）
// checkin_mode を返す（LIFF UI の出し分けに使用）

import { NextRequest } from "next/server";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { findLocationByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const locationIdOrPublic = new URL(req.url).searchParams.get("location_id");
    if (!locationIdOrPublic) return badRequest("location_id は必須です");

    // location_id は UUID か publicId のどちらでも受け付ける
    const location = await findLocationByIdOrPublicId(locationIdOrPublic);
    if (!location) {
      console.error(`[LIFF location-info] Location not found: locationIdOrPublic=${locationIdOrPublic}`);
      return notFound("ロケーション");
    }

    return ok({
      id:           location.id,
      name:         location.name,
      checkin_mode: location.checkinMode,
      is_active:    location.isActive,
      // ── 地図表示用の座標（additive）。既存フィールドは不変。
      //    目的地ピン / チェックイン範囲円の描画にのみ使用（判定は従来どおりサーバー側）。
      latitude:      location.latitude ?? null,
      longitude:     location.longitude ?? null,
      radius_meters: location.radiusMeters ?? null,
    });
  } catch (err) {
    return serverError(err);
  }
}
