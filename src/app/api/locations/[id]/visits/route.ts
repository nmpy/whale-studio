// src/app/api/locations/[id]/visits/route.ts
// GET /api/locations/:id/visits — ロケーションの訪問履歴（直近20件）
//
// location 機能は Pro プラン専用 (= /api/locations の作成 API と同じ要件)。
// 訪問履歴も同等の制限を掛け、API 直叩きで Pro 未契約の OA が履歴を覗けない
// ようにする。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (req, { params }, user) => {
  try {
    const location = await prisma.location.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true, title: true } } },
    });
    if (!location) return notFound("ロケーション");

    const check = await requireRole(location.work.oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    // プラン制限: location は Pro プラン以上が必要
    const planGuard = await requirePlanFeature({ oaId: location.work.oaId, featureKey: FEATURE.location });
    if (!planGuard.ok) return planGuard.response;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);

    const visits = await prisma.locationVisit.findMany({
      where: { locationId: params.id },
      orderBy: { visitedAt: "desc" },
      take: limit,
    });

    return ok(visits.map((v) => ({
      id:              v.id,
      line_user_id:    v.lineUserId,
      location_id:     v.locationId,
      work_id:         v.workId,
      checkin_method:  v.checkinMethod,
      distance_meters: v.distanceMeters,
      visited_at:      v.visitedAt,
    })));
  } catch (err) {
    return serverError(err);
  }
});
