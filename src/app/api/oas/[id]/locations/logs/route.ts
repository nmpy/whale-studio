// src/app/api/oas/[id]/locations/logs/route.ts
// GET /api/oas/[id]/locations/logs — GPS / QR / Beacon の実行ログを統合（read 専用）。
//
// 正規化ロジックは src/lib/location-log-query.ts の fetchUnifiedLogs に集約（CSV export と共有）。
// query: workId / type(gps|qr|beacon) / status / from / to / userId / locationId / beaconTriggerId / limit

import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { fetchUnifiedLogs } from "@/lib/location-log-query";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const GET = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const q = new URL(req.url).searchParams;
    const limitRaw = parseInt(q.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const result = await fetchUnifiedLogs(oaId, {
      workId:          q.get("workId")?.trim() || null,
      type:            q.get("type"),
      status:          q.get("status")?.trim() || null,
      userId:          q.get("userId")?.trim() || null,
      locationId:      q.get("locationId")?.trim() || null,
      beaconTriggerId: q.get("beaconTriggerId")?.trim() || null,
      from:            parseDate(q.get("from")),
      to:              parseDate(q.get("to")),
    }, limit);

    return ok(result.rows, {
      sources: result.sources,
      returned: result.rows.length,
      truncated: result.truncated,
    });
  } catch (err) {
    return serverError(err);
  }
});
