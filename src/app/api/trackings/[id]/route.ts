// src/app/api/trackings/[id]/route.ts
// GET    /api/trackings/:id — 詳細
// PATCH  /api/trackings/:id — 更新
// DELETE /api/trackings/:id — 削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { updateTrackingSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

const INCLUDE_STATS = { _count: { select: { events: true, userTrackings: true } } } as const;

function toResponse(t: {
  id: string; oaId: string; name: string; trackingId: string;
  targetUrl: string; utmEnabled: boolean;
  createdAt: Date; updatedAt: Date;
  _count?: { events: number; userTrackings: number };
}) {
  return {
    id:          t.id,
    oa_id:       t.oaId,
    name:        t.name,
    tracking_id: t.trackingId,
    target_url:  t.targetUrl,
    utm_enabled: t.utmEnabled,
    click_count: t._count?.events        ?? 0,
    user_count:  t._count?.userTrackings ?? 0,
    created_at:  t.createdAt,
    updated_at:  t.updatedAt,
  };
}

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const tracking = await prisma.tracking.findUnique({
      where:   { id: params.id },
      include: INCLUDE_STATS,
    });
    if (!tracking) return notFound("Tracking");
    return ok(toResponse(tracking));
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const tracking = await prisma.tracking.findUnique({ where: { id: params.id } });
    if (!tracking) return notFound("Tracking");

    const body = await req.json();
    const data = updateTrackingSchema.parse(body);

    const updated = await prisma.tracking.update({
      where: { id: params.id },
      data: {
        ...(data.name        !== undefined && { name:       data.name }),
        ...(data.tracking_id !== undefined && { trackingId: data.tracking_id }),
        ...(data.target_url  !== undefined && { targetUrl:  data.target_url }),
        ...(data.utm_enabled !== undefined && { utmEnabled: data.utm_enabled }),
      },
      include: INCLUDE_STATS,
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

export const DELETE = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const tracking = await prisma.tracking.findUnique({ where: { id: params.id } });
    if (!tracking) return notFound("Tracking");
    await prisma.tracking.delete({ where: { id: params.id } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
