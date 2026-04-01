// src/app/api/oas/[id]/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { updateOaSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

// ── GET /api/oas/:id ─────────────────────────────
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  'viewer',
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({
        where: { id: params.id },
        include: { _count: { select: { works: true } } },
      });
      if (!oa) return notFound("OA");

      return ok({
        id:                   oa.id,
        title:                oa.title,
        description:          oa.description,
        channel_id:           oa.channelId,
        line_oa_id:           oa.lineOaId           ?? null,
        channel_secret:       oa.channelSecret,
        channel_access_token: oa.channelAccessToken,
        publish_status:       oa.publishStatus,
        rich_menu_id:         oa.richMenuId ?? null,
        spreadsheet_id:       oa.spreadsheetId ?? null,
        created_at:           oa.createdAt,
        updated_at:           oa.updatedAt,
        _count:               oa._count,
      });
    } catch (err) {
      return serverError(err);
    }
  }
);

// ── PATCH /api/oas/:id ─── owner のみ（重要設定）
export const PATCH = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (req, { params }) => {
    try {
      const existing = await prisma.oa.findUnique({ where: { id: params.id } });
      if (!existing) return notFound("OA");

      const body = await req.json();
      const data = updateOaSchema.parse(body);

      const updated = await prisma.oa.update({
        where: { id: params.id },
        data: {
          ...(data.title                !== undefined && { title: data.title }),
          ...(data.description          !== undefined && { description: data.description }),
          ...(data.channel_id           !== undefined && { channelId: data.channel_id }),
          ...(data.line_oa_id           !== undefined && { lineOaId: data.line_oa_id }),
          ...(data.channel_secret       !== undefined && { channelSecret: data.channel_secret }),
          ...(data.channel_access_token !== undefined && { channelAccessToken: data.channel_access_token }),
          ...(data.publish_status       !== undefined && { publishStatus: data.publish_status }),
          ...(data.spreadsheet_id       !== undefined && { spreadsheetId: data.spreadsheet_id }),
        },
      });

      return ok({
        id:             updated.id,
        title:          updated.title,
        description:    updated.description,
        channel_id:     updated.channelId,
        line_oa_id:     updated.lineOaId     ?? null,
        publish_status: updated.publishStatus,
        rich_menu_id:   updated.richMenuId   ?? null,
        spreadsheet_id: updated.spreadsheetId ?? null,
        created_at:     updated.createdAt,
        updated_at:     updated.updatedAt,
      });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
      return serverError(err);
    }
  }
);

// ── DELETE /api/oas/:id ─── owner のみ
export const DELETE = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (_req, { params }) => {
    try {
      const existing = await prisma.oa.findUnique({ where: { id: params.id } });
      if (!existing) return notFound("OA");

      await prisma.oa.delete({ where: { id: params.id } });
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
