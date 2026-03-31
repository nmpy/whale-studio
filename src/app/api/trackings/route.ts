// src/app/api/trackings/route.ts
// GET  /api/trackings?oa_id=xxx — トラッキング一覧
// POST /api/trackings            — トラッキング作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createTrackingSchema, trackingQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { randomUUID } from "crypto";

function toResponse(t: {
  id: string; oaId: string; name: string; trackingId: string;
  targetUrl: string; utmEnabled: boolean;
  createdAt: Date; updatedAt: Date;
  _count?: { events: number; userTrackings: number };
}) {
  return {
    id:            t.id,
    oa_id:         t.oaId,
    name:          t.name,
    tracking_id:   t.trackingId,
    target_url:    t.targetUrl,
    utm_enabled:   t.utmEnabled,
    click_count:   t._count?.events        ?? 0,
    user_count:    t._count?.userTrackings ?? 0,
    created_at:    t.createdAt,
    updated_at:    t.updatedAt,
  };
}

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = trackingQuerySchema.parse({ oa_id: searchParams.get("oa_id") ?? undefined });

    const oa = await prisma.oa.findUnique({ where: { id: query.oa_id } });
    if (!oa) return notFound("OA");

    const trackings = await prisma.tracking.findMany({
      where:   { oaId: query.oa_id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { events: true, userTrackings: true } } },
    });

    return ok(trackings.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const data = createTrackingSchema.parse(body);

    const oa = await prisma.oa.findUnique({ where: { id: data.oa_id } });
    if (!oa) return notFound("OA");

    // tracking_id が未指定なら自動生成（UUID 先頭8文字）
    const trackingId = data.tracking_id ?? randomUUID().replace(/-/g, "").slice(0, 12);

    const tracking = await prisma.tracking.create({
      data: {
        oaId:       data.oa_id,
        name:       data.name,
        trackingId: trackingId,
        targetUrl:  data.target_url,
        utmEnabled: data.utm_enabled,
      },
      include: { _count: { select: { events: true, userTrackings: true } } },
    });

    return created(toResponse(tracking));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
