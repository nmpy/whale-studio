// src/app/api/segments/[id]/route.ts
// GET    /api/segments/:id — 詳細
// PATCH  /api/segments/:id — 更新
// DELETE /api/segments/:id — 削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { updateSegmentSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(s: {
  id: string; oaId: string; name: string; filterType: string;
  phaseId: string | null; status: string;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:          s.id,
    oa_id:       s.oaId,
    name:        s.name,
    filter_type: s.filterType,
    phase_id:    s.phaseId,
    status:      s.status,
    created_at:  s.createdAt,
    updated_at:  s.updatedAt,
  };
}

export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const segment = await prisma.segment.findUnique({ where: { id: params.id } });
    if (!segment) return notFound("Segment");
    return ok(toResponse(segment));
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const segment = await prisma.segment.findUnique({ where: { id: params.id } });
    if (!segment) return notFound("Segment");

    const body = await req.json();
    const data = updateSegmentSchema.parse(body);

    const updated = await prisma.segment.update({
      where: { id: params.id },
      data: {
        ...(data.name        !== undefined && { name:       data.name }),
        ...(data.filter_type !== undefined && { filterType: data.filter_type }),
        ...(data.phase_id    !== undefined && { phaseId:    data.phase_id }),
        ...(data.status      !== undefined && { status:     data.status }),
      },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

export const DELETE = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const segment = await prisma.segment.findUnique({ where: { id: params.id } });
    if (!segment) return notFound("Segment");
    await prisma.segment.delete({ where: { id: params.id } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
