// src/app/api/oas/[id]/sns/[snsId]/route.ts
// PATCH   /api/oas/:id/sns/:snsId — SNS投稿更新
// DELETE  /api/oas/:id/sns/:snsId — SNS投稿削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { updateSnsPostSchema, formatZodErrors } from "@/lib/validations";
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

// ── PATCH /api/oas/:id/sns/:snsId ────────────────
export const PATCH = withAuth<{ id: string; snsId: string }>(async (req, { params }) => {
  try {
    const existing = await prisma.snsPost.findFirst({
      where: { id: params.snsId, oaId: params.id },
    });
    if (!existing) return notFound("SnsPost");

    const body = await req.json();
    const data = updateSnsPostSchema.parse(body);

    const updated = await prisma.snsPost.update({
      where: { id: params.snsId },
      data: {
        ...(data.platform   !== undefined && { platform:  data.platform }),
        ...(data.text       !== undefined && { text:      data.text }),
        ...(data.image_url  !== undefined && { imageUrl:  data.image_url }),
        ...(data.target_url !== undefined && { targetUrl: data.target_url }),
        ...(data.order      !== undefined && { order:     data.order }),
      },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/oas/:id/sns/:snsId ───────────────
export const DELETE = withAuth<{ id: string; snsId: string }>(async (_req, { params }) => {
  try {
    const existing = await prisma.snsPost.findFirst({
      where: { id: params.snsId, oaId: params.id },
    });
    if (!existing) return notFound("SnsPost");

    await prisma.snsPost.delete({ where: { id: params.snsId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
