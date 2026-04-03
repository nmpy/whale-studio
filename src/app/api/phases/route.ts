// src/app/api/phases/route.ts
// GET  /api/phases?work_id=xxx — フェーズ一覧取得
// POST /api/phases              — フェーズ作成
//
// 整合性ルール（POST）:
//   - phaseType=start は 1作品につき 1件まで

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createPhaseSchema, phaseQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

function toResponse(p: {
  id: string; workId: string; phaseType: string; name: string; description: string | null;
  startTrigger: string | null;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  _count?: { messages: number; transitionsFrom: number };
}) {
  return {
    id:            p.id,
    work_id:       p.workId,
    phase_type:    p.phaseType,
    name:          p.name,
    description:   p.description,
    start_trigger: p.startTrigger,
    sort_order:    p.sortOrder,
    is_active:     p.isActive,
    created_at:    p.createdAt,
    updated_at:    p.updatedAt,
    ...(p._count !== undefined && { _count: p._count }),
  };
}

// ── GET /api/phases ──────────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = phaseQuerySchema.parse({
      work_id:    searchParams.get("work_id")    ?? undefined,
      phase_type: searchParams.get("phase_type") ?? undefined,
      is_active:  searchParams.get("is_active")  ?? undefined,
    });

    const work = await prisma.work.findUnique({ where: { id: query.work_id } });
    if (!work) return notFound("作品");

    const oaId = await getOaIdFromWorkId(query.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'viewer');
      if (!check.ok) return check.response;
    }

    const phases = await prisma.phase.findMany({
      where: {
        workId:    query.work_id,
        ...(query.phase_type !== undefined && { phaseType: query.phase_type }),
        ...(query.is_active  !== undefined && { isActive:  query.is_active }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { messages: true, transitionsFrom: true } } },
    });

    return ok(phases.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/phases ─────────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createPhaseSchema.parse(body);

    const work = await prisma.work.findUnique({ where: { id: data.work_id } });
    if (!work) return notFound("作品");

    const oaId = await getOaIdFromWorkId(data.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'editor');
      if (!check.ok) return check.response;
    }

    // ─ 整合性チェック: start フェーズは1作品に1件まで ─
    if (data.phase_type === "start") {
      const existingStart = await prisma.phase.findFirst({
        where: { workId: data.work_id, phaseType: "start" },
        select: { id: true, name: true },
      });
      if (existingStart) {
        return badRequest(
          `開始フェーズは1作品につき1件のみ作成できます（既存: 「${existingStart.name}」）`
        );
      }
    }

    const phase = await prisma.phase.create({
      data: {
        workId:       data.work_id,
        phaseType:    data.phase_type,
        name:         data.name,
        description:  data.description,
        startTrigger: data.start_trigger ?? null,
        sortOrder:    data.sort_order,
        isActive:     data.is_active,
      },
      include: { _count: { select: { messages: true, transitionsFrom: true } } },
    });

    // start フェーズ作成時はキャッシュを無効化
    if (phase.phaseType === "start") {
      await activeCache.delete(CACHE_KEY.startPhase(phase.workId));
    }

    return created(toResponse(phase));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
