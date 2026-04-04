// src/app/api/works/route.ts
// GET  /api/works?oa_id=xxx — 作品一覧取得（_count: characters, phases, messages）
// POST /api/works            — 作品作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { createWorkSchema, workQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

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

// ── GET /api/works ───────────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = workQuerySchema.parse({
      oa_id:          searchParams.get("oa_id")          ?? undefined,
      publish_status: searchParams.get("publish_status") ?? undefined,
    });

    // OA の存在確認
    const oa = await prisma.oa.findUnique({ where: { id: query.oa_id } });
    if (!oa) return notFound("OA");

    const check = await requireRole(query.oa_id, user.id, 'tester');
    if (!check.ok) return check.response;

    const works = await prisma.work.findMany({
      where: {
        oaId: query.oa_id,
        ...(query.publish_status !== undefined && { publishStatus: query.publish_status }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: { characters: true, phases: true, messages: true, userProgress: true },
        },
      },
    });

    return ok(
      works.map((w) => ({
        ...toResponse(w),
        _count: w._count,
      }))
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/works ──────────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createWorkSchema.parse(body);

    // OA の存在確認
    const oa = await prisma.oa.findUnique({ where: { id: data.oa_id } });
    if (!oa) return notFound("OA");

    const check = await requireRole(data.oa_id, user.id, 'editor');
    if (!check.ok) return check.response;

    const work = await prisma.work.create({
      data: {
        oaId:          data.oa_id,
        title:         data.title,
        description:   data.description,
        publishStatus: data.publish_status,
        sortOrder:     data.sort_order,
      },
    });

    // グローバルフェーズを自動作成（全フェーズ共通メッセージ用）
    await prisma.phase.create({
      data: {
        workId:      work.id,
        phaseType:   "global",
        name:        "全フェーズ共通",
        description: "どのフェーズでも反応するメッセージ（ヒント・ヘルプ等）",
        sortOrder:   -1,
        isActive:    true,
      },
    });

    // active 状態で作成した場合はキャッシュを無効化
    if (work.publishStatus === "active") {
      await activeCache.delete(CACHE_KEY.work(work.oaId));
    }

    return created(toResponse(work));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
