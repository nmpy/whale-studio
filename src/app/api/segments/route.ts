// src/app/api/segments/route.ts
// GET  /api/segments?oa_id=xxx — セグメント一覧
// POST /api/segments            — セグメント作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createSegmentSchema, segmentQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";
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

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = segmentQuerySchema.parse({ oa_id: searchParams.get("oa_id") ?? undefined });

    const oa = await prisma.oa.findUnique({ where: { id: query.oa_id } });
    if (!oa) return notFound("OA");

    const segments = await prisma.segment.findMany({
      where:   { oaId: query.oa_id },
      orderBy: { createdAt: "asc" },
    });

    return ok(segments.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const data = createSegmentSchema.parse(body);

    const oa = await prisma.oa.findUnique({ where: { id: data.oa_id } });
    if (!oa) return notFound("OA");

    const segment = await prisma.segment.create({
      data: {
        oaId:       data.oa_id,
        name:       data.name,
        filterType: data.filter_type,
        phaseId:    data.phase_id ?? null,
        status:     data.status,
      },
    });

    return created(toResponse(segment));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
