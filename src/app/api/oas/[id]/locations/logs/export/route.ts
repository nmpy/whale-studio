// src/app/api/oas/[id]/locations/logs/export/route.ts
// GET /api/oas/[id]/locations/logs/export — 統合ログを CSV（UTF-8 BOM 付き）で出力（read 専用）。
//
// 一覧と同じ正規化（fetchUnifiedLogs）を再利用。userId は末尾のみ、raw 全量は出さず detail（要約）のみ。
// CSV injection 対策は buildLogsCsv / csvCell（location-log.ts）で実施。limit は最大 5000。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { fetchUnifiedLogs } from "@/lib/location-log-query";
import { buildLogsCsv, jstFileStamp } from "@/lib/location-log";

export const dynamic = "force-dynamic";

const EXPORT_DEFAULT_LIMIT = 1000;
const EXPORT_MAX_LIMIT = 5000;

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
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), EXPORT_MAX_LIMIT) : EXPORT_DEFAULT_LIMIT;

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

    // message 名解決（Beacon の message_id → 本文スニペット）。失敗しても CSV 自体は出す。
    let messageNameById: Record<string, string> = {};
    const msgIds = [...new Set(result.rows.map((r) => r.message_id).filter((v): v is string => !!v))];
    if (msgIds.length > 0) {
      try {
        const msgs = await prisma.message.findMany({ where: { id: { in: msgIds } }, select: { id: true, body: true } });
        messageNameById = Object.fromEntries(
          msgs.map((m) => [m.id, (m.body && m.body.trim() ? m.body.trim().slice(0, 30) : m.id)]),
        );
      } catch { /* 解決失敗時は message_id をそのまま使う */ }
    }

    const csv = buildLogsCsv(result.rows, { messageNameById });
    const fileName = `whale-studio-location-logs-${jstFileStamp(new Date())}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
