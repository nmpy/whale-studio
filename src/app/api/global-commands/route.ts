// src/app/api/global-commands/route.ts
// GET  /api/global-commands?oa_id=xxx  — 一覧取得
// POST /api/global-commands             — 作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import {
  createGlobalCommandSchema,
  globalCommandQuerySchema,
  formatZodErrors,
} from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

function toResponse(c: {
  id: string; oaId: string; keyword: string; actionType: string;
  payload: string | null; isActive: boolean; sortOrder: number;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:          c.id,
    oa_id:       c.oaId,
    keyword:     c.keyword,
    action_type: c.actionType,
    payload:     c.payload,
    is_active:   c.isActive,
    sort_order:  c.sortOrder,
    created_at:  c.createdAt,
    updated_at:  c.updatedAt,
  };
}

// ── GET /api/global-commands ─────────────────────
export const GET = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = globalCommandQuerySchema.parse({
      oa_id: searchParams.get("oa_id") ?? undefined,
    });

    const oa = await prisma.oa.findUnique({ where: { id: query.oa_id } });
    if (!oa) return notFound("OA");

    const check = await requireRole(query.oa_id, user.id, "viewer");
    if (!check.ok) return check.response;

    const commands = await prisma.globalCommand.findMany({
      where:   { oaId: query.oa_id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return ok(commands.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/global-commands ────────────────────
export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createGlobalCommandSchema.parse(body);

    const oa = await prisma.oa.findUnique({ where: { id: data.oa_id } });
    if (!oa) return notFound("OA");

    const check = await requireRole(data.oa_id, user.id, "editor");
    if (!check.ok) return check.response;

    const command = await prisma.globalCommand.create({
      data: {
        oaId:       data.oa_id,
        keyword:    data.keyword.trim(),
        actionType: data.action_type,
        payload:    data.payload ?? null,
        isActive:   data.is_active,
        sortOrder:  data.sort_order,
      },
    });

    // キャッシュ無効化
    await activeCache.delete(CACHE_KEY.globalCmd(data.oa_id));

    return created(toResponse(command));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
