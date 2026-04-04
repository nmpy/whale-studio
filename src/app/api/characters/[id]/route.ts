// src/app/api/characters/[id]/route.ts
// GET    /api/characters/:id — キャラクター詳細
// PATCH  /api/characters/:id — キャラクター更新
// DELETE /api/characters/:id — キャラクター削除

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateCharacterSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(c: {
  id: string; workId: string; name: string; iconType: string; iconText: string | null;
  iconImageUrl: string | null; iconColor: string | null; sortOrder: number;
  isActive: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id:             c.id,
    work_id:        c.workId,
    name:           c.name,
    icon_type:      c.iconType,
    icon_text:      c.iconText,
    icon_image_url: c.iconImageUrl,
    icon_color:     c.iconColor,
    sort_order:     c.sortOrder,
    is_active:      c.isActive,
    created_at:     c.createdAt,
    updated_at:     c.updatedAt,
  };
}

// ── GET /api/characters/:id ──────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const character = await prisma.character.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!character) return notFound("キャラクター");

    const check = await requireRole(character.work.oaId, user.id, 'tester');
    if (!check.ok) return check.response;

    return ok(toResponse(character));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/characters/:id ────────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.character.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("キャラクター");

    const check = await requireRole(existing.work.oaId, user.id, 'editor');
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateCharacterSchema.parse(body);

    // 既存レコードと変更後の値を合わせた整合性チェック（create と同等）
    const nextType         = data.icon_type      ?? existing.iconType;
    const nextIconText     = data.icon_text      !== undefined ? data.icon_text      : existing.iconText;
    const nextIconImageUrl = data.icon_image_url !== undefined ? data.icon_image_url : existing.iconImageUrl;

    if (nextType === "text" && !nextIconText) {
      return badRequest("icon_type が text の場合、icon_text は必須です", {
        icon_text: ["text型の場合はアイコン文字が必要です"],
      });
    }
    if (nextType === "image" && !nextIconImageUrl) {
      return badRequest("icon_type が image の場合、icon_image_url は必須です", {
        icon_image_url: ["image型の場合はアイコン画像URLが必要です"],
      });
    }

    const updated = await prisma.character.update({
      where: { id: params.id },
      data: {
        ...(data.name           !== undefined && { name:         data.name }),
        ...(data.icon_type      !== undefined && { iconType:     data.icon_type }),
        ...(data.icon_text      !== undefined && { iconText:     data.icon_text }),
        ...(data.icon_image_url !== undefined && { iconImageUrl: data.icon_image_url }),
        ...(data.icon_color     !== undefined && { iconColor:    data.icon_color }),
        ...(data.sort_order     !== undefined && { sortOrder:    data.sort_order }),
        ...(data.is_active      !== undefined && { isActive:     data.is_active }),
      },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/characters/:id ───────────────────
export const DELETE = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.character.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("キャラクター");

    const check = await requireRole(existing.work.oaId, user.id, 'owner');
    if (!check.ok) return check.response;

    await prisma.character.delete({ where: { id: params.id } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
