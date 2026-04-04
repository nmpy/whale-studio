// src/app/api/transitions/route.ts
// GET  /api/transitions?from_phase_id=xxx — 遷移一覧（フェーズ別 or 作品別）
// POST /api/transitions                  — 遷移作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createTransitionSchema, transitionQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { trackOnboardingStep } from "@/lib/onboarding-tracker";
import { trackOnboardingProgress } from "@/lib/onboarding";

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

// ── GET /api/transitions ─────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = transitionQuerySchema.parse({
      work_id:       searchParams.get("work_id")       ?? undefined,
      from_phase_id: searchParams.get("from_phase_id") ?? undefined,
      to_phase_id:   searchParams.get("to_phase_id")   ?? undefined,
      is_active:     searchParams.get("is_active")     ?? undefined,
      with_phases:   searchParams.get("with_phases")   ?? undefined,
    });

    if (query.work_id) {
      const oaId = await getOaIdFromWorkId(query.work_id);
      if (oaId) {
        const check = await requireRole(oaId, user.id, 'viewer');
        if (!check.ok) return check.response;
      }
    }

    const transitions = await prisma.transition.findMany({
      where: {
        ...(query.work_id       && { workId:       query.work_id }),
        ...(query.from_phase_id && { fromPhaseId:  query.from_phase_id }),
        ...(query.to_phase_id   && { toPhaseId:    query.to_phase_id }),
        ...(query.is_active !== undefined && { isActive: query.is_active }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: query.with_phases
        ? { toPhase: { select: { id: true, name: true, phaseType: true } } }
        : undefined,
    });

    return ok(
      transitions.map((t) =>
        query.with_phases
          ? toResponse(t, (t as typeof t & { toPhase: { id: string; name: string; phaseType: string } | null }).toPhase)
          : toResponse(t)
      )
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/transitions ────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createTransitionSchema.parse(body);

    const oaId = await getOaIdFromWorkId(data.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'tester');
      if (!check.ok) return check.response;
    }

    // 遷移元フェーズの確認
    const fromPhase = await prisma.phase.findUnique({ where: { id: data.from_phase_id } });
    if (!fromPhase) return notFound("遷移元フェーズ");
    if (fromPhase.workId !== data.work_id) return badRequest("遷移元フェーズが指定作品に属していません");
    if (fromPhase.phaseType === "ending") return badRequest("エンディングフェーズからは遷移を追加できません");

    // 遷移先フェーズの確認
    const toPhase = await prisma.phase.findUnique({ where: { id: data.to_phase_id } });
    if (!toPhase) return notFound("遷移先フェーズ");
    if (toPhase.workId !== data.work_id) return badRequest("遷移先フェーズが指定作品に属していません");

    const transition = await prisma.transition.create({
      data: {
        workId:        data.work_id,
        fromPhaseId:   data.from_phase_id,
        toPhaseId:     data.to_phase_id,
        label:         data.label,
        condition:     data.condition,
        flagCondition: data.flag_condition,
        setFlags:      data.set_flags ?? "{}",
        sortOrder:     data.sort_order,
        isActive:      data.is_active,
      },
      include: { toPhase: { select: { id: true, name: true, phaseType: true } } },
    });

    // キャッシュ無効化（fromPhase のキャッシュに遷移情報が含まれるため）
    await activeCache.delete(CACHE_KEY.phase(data.from_phase_id));

    // オンボーディングステップ記録（fire-and-forget）
    if (oaId) trackOnboardingStep(data.work_id, oaId, "flow_connected");
    trackOnboardingProgress({ userId: user.id, workId: data.work_id, step: "flow_connected" });

    return created(toResponse(transition, transition.toPhase));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
