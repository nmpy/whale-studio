// src/app/api/oas/[id]/beacons/logs/route.ts
// GET /api/oas/[id]/beacons/logs — beacon 発火ログ一覧（フィルタ付き）
//
// クエリ:
//   work_id  : 作品で絞り込み（"common" で OA 共通=work_id null）
//   hwid     : HWID 部分一致（正規化前のゆるい一致）
//   outcome  : action_status 完全一致
//   user_id  : line_user_id 部分一致
//   from/to  : created_at 範囲（ISO 文字列）
//   limit    : 取得件数（default 100, max 300）

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { toBeaconEventLogResponse } from "@/lib/beacon-utils";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

export const GET = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const url = new URL(req.url);
    const q = url.searchParams;

    const where: Prisma.BeaconEventLogWhereInput = { oaId };

    const workId = q.get("work_id");
    if (workId === "common") where.workId = null;
    else if (workId) where.workId = workId;

    const hwid = q.get("hwid")?.trim();
    if (hwid) where.hwid = { contains: hwid.toLowerCase() };

    const outcome = q.get("outcome")?.trim();
    if (outcome) where.actionStatus = outcome;

    const userId = q.get("user_id")?.trim();
    if (userId) where.lineUserId = { contains: userId };

    const from = q.get("from");
    const to = q.get("to");
    if (from || to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (from) { const d = new Date(from); if (!isNaN(d.getTime())) createdAt.gte = d; }
      if (to)   { const d = new Date(to);   if (!isNaN(d.getTime())) createdAt.lte = d; }
      if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
    }

    const limitRaw = parseInt(q.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const logs = await prisma.beaconEventLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // トリガー名・作品名を join（N+1 回避）
    const triggerIds = [...new Set(logs.map((l) => l.beaconTriggerId).filter((v): v is string => !!v))];
    const workIds    = [...new Set(logs.map((l) => l.workId).filter((v): v is string => !!v))];
    const [triggers, works] = await Promise.all([
      triggerIds.length > 0
        ? prisma.beaconTrigger.findMany({ where: { id: { in: triggerIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      workIds.length > 0
        ? prisma.work.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true } })
        : Promise.resolve([]),
    ]);
    const triggerName = new Map(triggers.map((t) => [t.id, t.name]));
    const workTitle   = new Map(works.map((w) => [w.id, w.title]));

    return ok(
      logs.map((l) =>
        toBeaconEventLogResponse(l, {
          triggerName: l.beaconTriggerId ? triggerName.get(l.beaconTriggerId) ?? null : null,
          workTitle:   l.workId ? workTitle.get(l.workId) ?? null : null,
        }),
      ),
    );
  } catch (err) {
    return serverError(err);
  }
});
