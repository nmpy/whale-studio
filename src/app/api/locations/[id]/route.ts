// src/app/api/locations/[id]/route.ts
// GET    /api/locations/:id — ロケーション詳細
// PATCH  /api/locations/:id — ロケーション更新
// DELETE /api/locations/:id — ロケーション削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateLocationSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(
  l: {
    id: string; workId: string; name: string; description: string | null;
    beaconUuid: string | null; beaconMajor: number | null; beaconMinor: number | null;
    cooldownSeconds: number; transitionId: string | null; setFlags: string;
    sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  },
  transition?: {
    id: string; label: string;
    toPhase: { id: string; name: string; phaseType: string } | null;
  } | null,
) {
  return {
    id:               l.id,
    work_id:          l.workId,
    name:             l.name,
    description:      l.description,
    beacon_uuid:      l.beaconUuid,
    beacon_major:     l.beaconMajor,
    beacon_minor:     l.beaconMinor,
    cooldown_seconds: l.cooldownSeconds,
    transition_id:    l.transitionId,
    set_flags:        l.setFlags,
    sort_order:       l.sortOrder,
    is_active:        l.isActive,
    created_at:       l.createdAt,
    updated_at:       l.updatedAt,
    ...(transition !== undefined && {
      transition: transition
        ? {
            id:    transition.id,
            label: transition.label,
            to_phase: transition.toPhase
              ? { id: transition.toPhase.id, name: transition.toPhase.name, phase_type: transition.toPhase.phaseType }
              : null,
          }
        : null,
    }),
  };
}

const includeTransition = {
  transition: {
    select: {
      id: true, label: true,
      toPhase: { select: { id: true, name: true, phaseType: true } },
    },
  },
} as const;

// ── GET /api/locations/:id ──────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const location = await prisma.location.findUnique({
      where:   { id: params.id },
      include: {
        ...includeTransition,
        work: { select: { oaId: true } },
      },
    });
    if (!location) return notFound("ロケーション");

    const check = await requireRole(location.work.oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    return ok(toResponse(location, location.transition));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/locations/:id ────────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.location.findUnique({
      where:   { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("ロケーション");

    const check = await requireRole(existing.work.oaId, user.id, "tester");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateLocationSchema.parse(body);

    // transition_id が変更される場合、同じ作品に属するか確認
    if (data.transition_id) {
      const transition = await prisma.transition.findUnique({ where: { id: data.transition_id } });
      if (!transition) return notFound("遷移");
      if (transition.workId !== existing.workId) return badRequest("指定された遷移が同じ作品に属していません");
    }

    const updated = await prisma.location.update({
      where: { id: params.id },
      data: {
        ...(data.name             !== undefined && { name:            data.name }),
        ...(data.description      !== undefined && { description:     data.description }),
        ...(data.beacon_uuid      !== undefined && { beaconUuid:      data.beacon_uuid }),
        ...(data.beacon_major     !== undefined && { beaconMajor:     data.beacon_major }),
        ...(data.beacon_minor     !== undefined && { beaconMinor:     data.beacon_minor }),
        ...(data.cooldown_seconds !== undefined && { cooldownSeconds: data.cooldown_seconds }),
        ...(data.transition_id    !== undefined && { transitionId:    data.transition_id }),
        ...(data.set_flags        !== undefined && { setFlags:        data.set_flags }),
        ...(data.sort_order       !== undefined && { sortOrder:       data.sort_order }),
        ...(data.is_active        !== undefined && { isActive:        data.is_active }),
      },
      include: includeTransition,
    });

    return ok(toResponse(updated, updated.transition));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/locations/:id ───────────────────
export const DELETE = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.location.findUnique({
      where:   { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("ロケーション");

    const check = await requireRole(existing.work.oaId, user.id, "tester");
    if (!check.ok) return check.response;

    await prisma.location.delete({ where: { id: params.id } });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
