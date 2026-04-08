// src/app/api/liff/checkin-attempt/route.ts
// POST /api/liff/checkin-attempt — クライアント側 GPS 失敗ログ送信（認証不要）
// permission_denied / gps_unavailable など、API到達前にクライアントで分かる失敗を記録する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "permission_denied",
  "gps_unavailable",
  "timeout",
  "unknown_error",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const workId     = typeof body.work_id === "string" ? body.work_id : "";
    const locationId = typeof body.location_id === "string" ? body.location_id : "";
    const lineUserId = typeof body.line_user_id === "string" ? body.line_user_id : "";
    const status     = typeof body.status === "string" ? body.status : "";

    if (!workId || !locationId || !lineUserId || !status) {
      return badRequest("必須パラメータが不足しています");
    }
    if (!VALID_STATUSES.has(status)) {
      return badRequest("無効なステータスです");
    }

    await prisma.checkinAttempt.create({
      data: {
        workId,
        locationId,
        lineUserId,
        method:        "gps",
        status,
        failureReason: typeof body.failure_reason === "string" ? body.failure_reason : null,
        lat:           typeof body.lat === "number" ? body.lat : null,
        lng:           typeof body.lng === "number" ? body.lng : null,
      },
    });

    return ok({ recorded: true });
  } catch (err) {
    return serverError(err);
  }
}
