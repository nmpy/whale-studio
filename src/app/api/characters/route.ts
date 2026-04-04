// src/app/api/characters/route.ts
// GET  /api/characters?work_id=xxx — キャラクター一覧取得
// POST /api/characters              — キャラクター作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createCharacterSchema, characterQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
// OnboardingEvent write 停止済み（Phase 3）— trackOnboardingStep import を削除
import { trackOnboardingProgress } from "@/lib/onboarding";

export const dynamic = "force-dynamic";
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

// ── GET /api/characters ──────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = characterQuerySchema.parse({
      work_id:   searchParams.get("work_id")   ?? undefined,
      is_active: searchParams.get("is_active") ?? undefined,
    });

    // Work の存在確認
    const work = await prisma.work.findUnique({ where: { id: query.work_id } });
    if (!work) return notFound("作品");

    const oaId = await getOaIdFromWorkId(query.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'viewer');
      if (!check.ok) return check.response;
    }

    const characters = await prisma.character.findMany({
      where: {
        workId:   query.work_id,
        ...(query.is_active !== undefined && { isActive: query.is_active }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return ok(characters.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/characters ─────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createCharacterSchema.parse(body);

    // Work の存在確認
    const work = await prisma.work.findUnique({ where: { id: data.work_id } });
    if (!work) return notFound("作品");

    const oaId = await getOaIdFromWorkId(data.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'tester');
      if (!check.ok) return check.response;
    }

    const character = await prisma.character.create({
      data: {
        workId:       data.work_id,
        name:         data.name,
        iconType:     data.icon_type,   // 常に "image"
        iconImageUrl: data.icon_image_url,
        sortOrder:    data.sort_order,
        isActive:     data.is_active,
      },
    });

    // オンボーディングステップ記録（fire-and-forget）
    trackOnboardingProgress({ userId: user.id, workId: data.work_id, step: "character_created" });

    return created(toResponse(character));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
