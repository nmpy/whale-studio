// src/app/api/admin/announcements/[id]/route.ts
// GET    /api/admin/announcements/[id] — 個別取得
// PATCH  /api/admin/announcements/[id] — 更新
// DELETE /api/admin/announcements/[id] — 削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { updateAnnouncementSchema, formatZodErrors } from "@/lib/validations";
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
export const GET = withPlatformAdmin(async (
  _req: NextRequest,
  { params }: { params: { id: string } },
) => {
  try {
    const announcement = await prisma.adminAnnouncement.findUnique({
      where: { id: params.id },
    });
    if (!announcement) return notFound("お知らせ");

    return ok(toResponse(announcement));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH ─────────────────────────────────────────
export const PATCH = withPlatformAdmin(async (
  req: NextRequest,
  { params }: { params: { id: string } },
  user,
) => {
  try {
    const existing = await prisma.adminAnnouncement.findUnique({
      where: { id: params.id },
    });
    if (!existing) return notFound("お知らせ");

    const body = await req.json();
    const data = updateAnnouncementSchema.parse(body);

    // Determine publishedAt and audit action
    let publishedAt = existing.publishedAt;
    let auditAction = "update";

    if (data.publish === true && existing.publishedAt === null) {
      publishedAt = new Date();
      auditAction = "publish";
    } else if (data.publish === false) {
      publishedAt = null;
      auditAction = "unpublish";
    }

    const updated = await prisma.adminAnnouncement.update({
      where: { id: params.id },
      data: {
        ...(data.type      !== undefined && { type:      data.type }),
        ...(data.title     !== undefined && { title:     data.title }),
        ...(data.body      !== undefined && { body:      data.body }),
        ...(data.important !== undefined && { important: data.important }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        publishedAt,
        updatedBy: user.id,
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        actorId:    user.id,
        action:     auditAction,
        resource:   "announcement",
        resourceId: params.id,
      },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE ────────────────────────────────────────
export const DELETE = withPlatformAdmin(async (
  _req: NextRequest,
  { params }: { params: { id: string } },
  user,
) => {
  try {
    const existing = await prisma.adminAnnouncement.findUnique({
      where: { id: params.id },
    });
    if (!existing) return notFound("お知らせ");

    await prisma.adminAnnouncement.delete({ where: { id: params.id } });

    await prisma.adminAuditLog.create({
      data: {
        actorId:    user.id,
        action:     "delete",
        resource:   "announcement",
        resourceId: params.id,
      },
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
