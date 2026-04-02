// src/app/api/transitions/[id]/route.ts
// GET    /api/transitions/:id — 遷移詳細
// PATCH  /api/transitions/:id — 遷移更新
// DELETE /api/transitions/:id — 遷移削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { updateTransitionSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

function toResponse(
  t: {
    id: string; workId: string; fromPhaseId: string; toPhaseId: string;
    label: string; condition: string | null;
    flagCondition: string | null; setFlags: string;
    sortOrder: number; isActive: boolean;
    createdAt: Date; updatedAt: Date;
  },
  toPhase?: { id: string; name: string; phaseType: string } | null,
) {
  return {
    id:             t.id,
    work_id:        t.workId,
    from_phase_id:  t.fromPhaseId,
    to_phase_id:    t.toPhaseId,
    label:          t.label,
    condition:      t.condition,
    flag_condition: t.flagCondition,
    set_flags:      t.setFlags,
    sort_order:     t.sortOrder,
    is_active:      t.isActive,
    created_at:     t.createdAt,
    updated_at:     t.updatedAt,
    ...(toPhase !== undefined && {
      to_phase: toPhase
        ? { id: toPhase.id, name: toPhase.name, phase_type: toPhase.phaseType }
        : null,
    }),
  };
}

// ── GET /api/transitions/:id ─────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const transition = await prisma.transition.findUnique({
      where: { id: params.id },
      include: { toPhase: { select: { id: true, name: true, phaseType: true } } },
    });
    if (!transition) return notFound("遷移");

    return ok(toResponse(transition, transition.toPhase));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/transitions/:id ───────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const existing = await prisma.transition.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("遷移");

    const body = await req.json();
    const data = updateTransitionSchema.parse(body);

    // 遷移先変更時の検証
    if (data.to_phase_id) {
      if (data.to_phase_id === existing.fromPhaseId) {
        return badRequest("遷移元と遷移先に同じフェーズは指定できません");
      }
      const toPhase = await prisma.phase.findUnique({ where: { id: data.to_phase_id } });
      if (!toPhase) return notFound("遷移先フェーズ");
      if (toPhase.workId !== existing.workId) return badRequest("遷移先フェーズが同じ作品に属していません");
    }

    const updated = await prisma.transition.update({
      where: { id: params.id },
      data: {
        ...(data.to_phase_id    !== undefined && { toPhaseId:     data.to_phase_id }),
        ...(data.label          !== undefined && { label:         data.label }),
        ...(data.condition      !== undefined && { condition:     data.condition }),
        ...(data.flag_condition !== undefined && { flagCondition: data.flag_condition }),
        ...(data.set_flags      !== undefined && { setFlags:      data.set_flags }),
        ...(data.sort_order     !== undefined && { sortOrder:     data.sort_order }),
        ...(data.is_active      !== undefined && { isActive:      data.is_active }),
      },
      include: { toPhase: { select: { id: true, name: true, phaseType: true } } },
    });

    // キャッシュ無効化（遷移は fromPhase のキャッシュに含まれる）
    await activeCache.delete(CACHE_KEY.phase(existing.fromPhaseId));

    return ok(toResponse(updated, updated.toPhase));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/transitions/:id ──────────────────
export const DELETE = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const existing = await prisma.transition.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("遷移");

    await prisma.transition.delete({ where: { id: params.id } });

    // キャッシュ無効化（fromPhase のキャッシュに遷移情報が含まれるため）
    await activeCache.delete(CACHE_KEY.phase(existing.fromPhaseId));

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
