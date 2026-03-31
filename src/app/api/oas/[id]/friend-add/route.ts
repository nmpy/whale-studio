// src/app/api/oas/[id]/friend-add/route.ts
// GET  /api/oas/:id/friend-add — 友だち追加設定取得
// PUT  /api/oas/:id/friend-add — 友だち追加設定作成・更新（upsert）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { putFriendAddSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(s: {
  id: string;
  oaId: string;
  campaignName: string | null;
  addUrl: string;
  qrCodeUrl: string | null;
  shareImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id:              s.id,
    oa_id:           s.oaId,
    campaign_name:   s.campaignName,
    add_url:         s.addUrl,
    qr_code_url:     s.qrCodeUrl,
    share_image_url: s.shareImageUrl,
    created_at:      s.createdAt,
    updated_at:      s.updatedAt,
  };
}

// ── GET /api/oas/:id/friend-add ──────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");

    const settings = await prisma.friendAddSettings.findUnique({
      where: { oaId: params.id },
    });

    if (!settings) return notFound("FriendAddSettings");
    return ok(toResponse(settings));
  } catch (err) {
    return serverError(err);
  }
});

// ── PUT /api/oas/:id/friend-add ──────────────────
export const PUT = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");

    const body = await req.json();
    console.log("[friend-add PUT] received body:", JSON.stringify(body));
    const data = putFriendAddSchema.parse(body);

    const settings = await prisma.friendAddSettings.upsert({
      where:  { oaId: params.id },
      create: {
        oaId:          params.id,
        addUrl:        data.add_url,
        campaignName:  data.campaign_name   ?? null,
        qrCodeUrl:     data.qr_code_url     ?? null,
        shareImageUrl: data.share_image_url ?? null,
      },
      update: {
        addUrl:        data.add_url,
        campaignName:  data.campaign_name   ?? null,
        qrCodeUrl:     data.qr_code_url     ?? null,
        shareImageUrl: data.share_image_url ?? null,
      },
    });

    return ok(toResponse(settings));
  } catch (err) {
    if (err instanceof ZodError) {
      console.error("[friend-add PUT] ZodError:", formatZodErrors(err));
      return badRequest("入力値が不正です", formatZodErrors(err));
    }
    console.error("[friend-add PUT] UNEXPECTED ERROR:", err);
    return serverError(err);
  }
});
