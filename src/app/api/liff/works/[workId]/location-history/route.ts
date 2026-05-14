// src/app/api/liff/works/[workId]/location-history/route.ts
// GET /api/liff/works/[workId]/location-history?line_user_id=xxx
// — LIFF location モード用: ユーザー本人のチェックイン履歴を返す公開エンドポイント（認証不要）
//
// LocationVisit (= 成功したチェックインのみ) を visitedAt 降順で返す。
// 仕様:
//   - line_user_id 必須。未指定なら 400。
//   - work_id に紐づく LocationVisit を読み、Location.name / checkin_mode と JOIN する。
//   - チェックイン種別の表記揺れをまとめる:
//       * LocationVisit.checkinMethod は "qr" | "gps" | "beacon"
//       * Location.checkinMode は "qr_only" | "gps_only" | "qr_and_gps"
//       これらから UI 表示用に "qr" | "gps" | "qr_and_gps" | "beacon" に正規化する。
//   - 上限件数 100 件（履歴 UI のための妥当な上限）

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 100;

type DisplayMethod = "qr" | "gps" | "qr_and_gps" | "beacon";

function normalizeMethod(visitMethod: string, locationMode: string): DisplayMethod {
  // visit.checkinMethod は単一手段の記録。location.checkinMode は地点の対応モード。
  // 例: visit が "gps" でも、その地点が "qr_and_gps" なら表示は "qr_and_gps" にしたい。
  if (locationMode === "qr_and_gps") return "qr_and_gps";
  if (visitMethod === "beacon") return "beacon";
  if (visitMethod === "gps") return "gps";
  return "qr";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId: workIdOrPublic } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const lineUserId = searchParams.get("line_user_id");

    if (!lineUserId) {
      return NextResponse.json(
        { success: false, error: { code: "BAD_REQUEST", message: "line_user_id は必須です" } },
        { status: 400 }
      );
    }

    // workId は UUID か publicId のどちらでも受け付ける
    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) {
      console.error(`[LIFF Location History] Work not found: workIdOrPublic=${workIdOrPublic}`);
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "作品が見つかりません" } },
        { status: 404 }
      );
    }

    const visits = await prisma.locationVisit.findMany({
      where: { workId: work.id, lineUserId },
      orderBy: { visitedAt: "desc" },
      take: MAX_ITEMS,
      select: {
        id:             true,
        visitedAt:      true,
        checkinMethod:  true,
        distanceMeters: true,
        locationId:     true,
        location: {
          select: {
            name:        true,
            checkinMode: true,
          },
        },
      },
    });

    const items = visits.map((v) => ({
      id:              v.id,
      location_id:     v.locationId,
      location_name:   v.location?.name ?? "（削除された地点）",
      visited_at:      v.visitedAt.toISOString(),
      checkin_method:  normalizeMethod(v.checkinMethod, v.location?.checkinMode ?? "qr_only"),
      distance_meters: v.distanceMeters ?? null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        work_id: work.id,
        total:   items.length,
        items,
      },
    });
  } catch (err) {
    console.error("[LIFF Location History Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
