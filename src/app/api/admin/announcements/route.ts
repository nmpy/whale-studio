// src/app/api/admin/announcements/route.ts
// GET  /api/admin/announcements — 管理者向け全件取得
// POST /api/admin/announcements — 作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { createAnnouncementSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(a: {
  id: string;
  type: string;
  title: string;
  body: string;
  important: boolean;
  publishedAt: Date | null;
  sortOrder: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id:           a.id,
    type:         a.type,
    title:        a.title,
    body:         a.body,
    important:    a.important,
    published_at: a.publishedAt?.toISOString() ?? null,
    sort_order:   a.sortOrder,
    created_by:   a.createdBy,
    updated_by:   a.updatedBy,
    created_at:   a.createdAt.toISOString(),
    updated_at:   a.updatedAt.toISOString(),
  };
}

// ── GET ──────────────────────────────────────────
export const GET = withPlatformAdmin(async (_req: NextRequest) => {
  try {
    const announcements = await prisma.adminAnnouncement.findMany({
      orderBy: [
        { sortOrder: "asc" },
        { createdAt: "desc" },
      ],
    });

    return ok(announcements.map(toResponse));
  } catch (err) {
    return serverError(err);
  }
});

// ── POST ─────────────────────────────────────────
export const POST = withPlatformAdmin(async (req: NextRequest, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createAnnouncementSchema.parse(body);

    const now = new Date();
    const announcement = await prisma.adminAnnouncement.create({
      data: {
        type:        data.type,
        title:       data.title,
        body:        data.body,
        important:   data.important,
        sortOrder:   data.sortOrder,
        publishedAt: data.publish ? now : null,
        createdBy:   user.id,
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        actorId:    user.id,
        action:     "create",
        resource:   "announcement",
        resourceId: announcement.id,
      },
    });

    return created(toResponse(announcement));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
