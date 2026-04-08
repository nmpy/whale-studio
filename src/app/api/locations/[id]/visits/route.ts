// src/app/api/locations/[id]/visits/route.ts
// GET /api/locations/:id/visits — ロケーションの訪問履歴（直近20件）

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";

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
