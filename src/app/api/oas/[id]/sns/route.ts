// src/app/api/oas/[id]/sns/route.ts
// GET   /api/oas/:id/sns — SNS投稿一覧取得
// POST  /api/oas/:id/sns — SNS投稿作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createSnsPostSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(p: {
  id: string;
  oaId: string;
  platform: string;
  text: string;
  imageUrl: string | null;
  targetUrl: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id:         p.id,
    oa_id:      p.oaId,
    platform:   p.platform,
    text:       p.text,
    image_url:  p.imageUrl,
    target_url: p.targetUrl,
    order:      p.order,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ── GET /api/oas/:id/sns ─────────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");

    const posts = await prisma.snsPost.findMany({
      where:   { oaId: params.id },
      orderBy: { order: "asc" },
    });

    return ok(posts.map(toResponse));
  } catch (err) {
    return serverError(err);
  }
});

// ── POST /api/oas/:id/sns ────────────────────────
export const POST = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");

    const body = await req.json();
    const data = createSnsPostSchema.parse(body);

    const post = await prisma.snsPost.create({
      data: {
        oaId:      params.id,
        platform:  data.platform,
        text:      data.text,
        imageUrl:  data.image_url  ?? null,
        targetUrl: data.target_url ?? null,
        order:     data.order      ?? 0,
      },
    });

    return created(toResponse(post));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
