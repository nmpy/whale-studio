// src/app/api/liff/stamp-rally/route.ts
// GET /api/liff/stamp-rally?work_id=xxx&line_user_id=yyy — スタンプラリー進捗取得（プレイヤー向け・認証不要）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import type { StampRallyProgress } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workId     = searchParams.get("work_id");
    const lineUserId = searchParams.get("line_user_id");

    if (!workId || !lineUserId) {
      return badRequest("work_id と line_user_id は必須です");
    }

    // スタンプ対象ロケーションを取得
    const locations = await prisma.location.findMany({
      where: { workId, stampEnabled: true, isActive: true },
      select: { id: true, name: true, stampLabel: true, stampOrder: true, sortOrder: true },
      orderBy: [{ stampOrder: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });

    if (locations.length === 0) {
      return ok<StampRallyProgress>({
        work_id:         workId,
        total_count:     0,
        completed_count: 0,
        is_completed:    true,
        locations:       [],
      });
    }

    // ユーザーの訪問済みロケーションを取得（distinct location_id）
    const visits = await prisma.locationVisit.findMany({
      where: {
        workId,
        lineUserId,
        locationId: { in: locations.map((l) => l.id) },
      },
      distinct: ["locationId"],
      orderBy: { visitedAt: "asc" },
      select: { locationId: true, visitedAt: true },
    });

    const visitMap = new Map(visits.map((v) => [v.locationId, v.visitedAt]));

    const completedCount = visitMap.size;
    const totalCount     = locations.length;

    const result: StampRallyProgress = {
      work_id:         workId,
      total_count:     totalCount,
      completed_count: completedCount,
      is_completed:    completedCount >= totalCount,
      locations: locations.map((loc) => {
        const visitedAt = visitMap.get(loc.id);
        return {
          location_id:   loc.id,
          name:          loc.name,
          stamp_label:   loc.stampLabel ?? loc.name,
          order:         loc.stampOrder,
          checked_in:    !!visitedAt,
          ...(visitedAt && { checked_in_at: visitedAt.toISOString() }),
        };
      }),
    };

    return ok(result);
  } catch (err) {
    return serverError(err);
  }
}
