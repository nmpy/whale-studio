// src/app/api/locations/route.ts
// GET  /api/locations?work_id=xxx — ロケーション一覧
// POST /api/locations             — ロケーション作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createLocationSchema, locationQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

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

// ── GET /api/locations ──────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = locationQuerySchema.parse({
      work_id:   searchParams.get("work_id") ?? undefined,
      is_active: searchParams.get("is_active") ?? undefined,
    });

    const oaId = await getOaIdFromWorkId(query.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, "viewer");
      if (!check.ok) return check.response;
    }

    const locations = await prisma.location.findMany({
      where: {
        workId:   query.work_id,
        ...(query.is_active !== undefined && { isActive: query.is_active }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        transition: {
          select: {
            id: true, label: true,
            toPhase: { select: { id: true, name: true, phaseType: true } },
          },
        },
      },
    });

    return ok(locations.map((l) => toResponse(l, l.transition)));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/locations ─────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createLocationSchema.parse(body);

    // 作品の存在確認 + 権限チェック
    const work = await prisma.work.findUnique({ where: { id: data.work_id }, select: { id: true, oaId: true } });
    if (!work) return notFound("作品");
    const check = await requireRole(work.oaId, user.id, "tester");
    if (!check.ok) return check.response;

    // transition_id が指定されている場合、同じ作品に属するか確認
    if (data.transition_id) {
      const transition = await prisma.transition.findUnique({ where: { id: data.transition_id } });
      if (!transition) return notFound("遷移");
      if (transition.workId !== data.work_id) return badRequest("指定された遷移が同じ作品に属していません");
    }

    const location = await prisma.location.create({
      data: {
        workId:          data.work_id,
        name:            data.name,
        description:     data.description,
        beaconUuid:      data.beacon_uuid,
        beaconMajor:     data.beacon_major,
        beaconMinor:     data.beacon_minor,
        cooldownSeconds: data.cooldown_seconds,
        transitionId:    data.transition_id,
        setFlags:        data.set_flags ?? "{}",
        sortOrder:       data.sort_order,
        isActive:        data.is_active,
      },
      include: {
        transition: {
          select: {
            id: true, label: true,
            toPhase: { select: { id: true, name: true, phaseType: true } },
          },
        },
      },
    });

    return created(toResponse(location, location.transition));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
