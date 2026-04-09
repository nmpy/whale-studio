// src/app/api/liff/checkin-attempt/route.ts
// POST /api/liff/checkin-attempt — クライアント側 GPS 失敗ログ送信（認証不要）
// permission_denied / gps_unavailable など、API到達前にクライアントで分かる失敗を記録する。
//
// 重複抑制: 同一 (workId, locationId, lineUserId, status) が直近 15 秒以内にあればスキップ。

import { NextRequest } from "next/server";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { logAttemptDeduped } from "@/lib/checkin-attempt";

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

    const saved = await logAttemptDeduped({
      workId,
      locationId,
      lineUserId,
      method:        "gps",
      status,
      failureReason: typeof body.failure_reason === "string" ? body.failure_reason : undefined,
      lat:           typeof body.lat === "number" ? body.lat : undefined,
      lng:           typeof body.lng === "number" ? body.lng : undefined,
    });

    return ok({ recorded: saved });
  } catch (err) {
    return serverError(err);
  }
}
