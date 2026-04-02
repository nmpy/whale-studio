// src/app/api/works/[id]/route.ts
// GET    /api/works/:id — 作品詳細（_count 付き）
// PATCH  /api/works/:id — 作品更新
// DELETE /api/works/:id — 作品削除（CASCADE: characters/phases/messages も削除）

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateWorkSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(w: {
  id: string; oaId: string; title: string; description: string | null;
  publishStatus: string; sortOrder: number; systemCharacterId: string | null;
  welcomeMessage: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:                  w.id,
    oa_id:               w.oaId,
    title:               w.title,
    description:         w.description,
    publish_status:      w.publishStatus,
    sort_order:          w.sortOrder,
    system_character_id: w.systemCharacterId,
    welcome_message:     w.welcomeMessage,
    created_at:          w.createdAt,
    updated_at:          w.updatedAt,
  };
}

// ── GET /api/works/:id ───────────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const work = await prisma.work.findUnique({
      where: { id: params.id },
      include: {
        _count: {
          select: { characters: true, phases: true, messages: true, userProgress: true },
        },
      },
    });
    if (!work) return notFound("作品");

    const check = await requireRole(work.oaId, user.id, 'viewer');
    if (!check.ok) return check.response;

    return ok({ ...toResponse(work), _count: work._count });
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/works/:id ─────────────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.work.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("作品");

    const check = await requireRole(existing.oaId, user.id, 'editor');
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateWorkSchema.parse(body);

    const updated = await prisma.work.update({
      where: { id: params.id },
      data: {
        ...(data.title               !== undefined && { title:              data.title }),
        ...(data.description         !== undefined && { description:        data.description }),
        ...(data.publish_status      !== undefined && { publishStatus:      data.publish_status }),
        ...(data.sort_order          !== undefined && { sortOrder:          data.sort_order }),
        ...(data.system_character_id !== undefined && { systemCharacterId:  data.system_character_id }),
        ...(data.welcome_message     !== undefined && { welcomeMessage:     data.welcome_message }),
      },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/works/:id ────────────────────────
export const DELETE = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.work.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("作品");

    const check = await requireRole(existing.oaId, user.id, 'owner');
    if (!check.ok) return check.response;

    // CASCADE により characters / phases / messages も削除される
    await prisma.work.delete({ where: { id: params.id } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
