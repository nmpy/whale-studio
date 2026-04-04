// src/app/api/global-commands/[id]/route.ts
// GET    /api/global-commands/[id] — 詳細取得
// PATCH  /api/global-commands/[id] — 更新
// DELETE /api/global-commands/[id] — 削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateGlobalCommandSchema, formatZodErrors } from "@/lib/validations";
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

// ── GET ──────────────────────────────────────────
export const GET = withAuth(async (
  _req: NextRequest,
  { params }: { params: { id: string } },
  user,
) => {
  try {
    const command = await prisma.globalCommand.findUnique({ where: { id: params.id } });
    if (!command) return notFound("グローバルコマンド");

    const check = await requireRole(command.oaId, user.id, "tester");
    if (!check.ok) return check.response;

    return ok(toResponse(command));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH ─────────────────────────────────────────
export const PATCH = withAuth(async (
  req: NextRequest,
  { params }: { params: { id: string } },
  user,
) => {
  try {
    const command = await prisma.globalCommand.findUnique({ where: { id: params.id } });
    if (!command) return notFound("グローバルコマンド");

    const check = await requireRole(command.oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateGlobalCommandSchema.parse(body);

    const updated = await prisma.globalCommand.update({
      where: { id: params.id },
      data: {
        ...(data.keyword     !== undefined && { keyword:    data.keyword.trim() }),
        ...(data.action_type !== undefined && { actionType: data.action_type }),
        ...(data.payload     !== undefined && { payload:    data.payload }),
        ...(data.is_active   !== undefined && { isActive:   data.is_active }),
        ...(data.sort_order  !== undefined && { sortOrder:  data.sort_order }),
      },
    });

    // キャッシュ無効化
    await activeCache.delete(CACHE_KEY.globalCmd(command.oaId));

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE ────────────────────────────────────────
export const DELETE = withAuth(async (
  _req: NextRequest,
  { params }: { params: { id: string } },
  user,
) => {
  try {
    const command = await prisma.globalCommand.findUnique({ where: { id: params.id } });
    if (!command) return notFound("グローバルコマンド");

    const check = await requireRole(command.oaId, user.id, "editor");
    if (!check.ok) return check.response;

    await prisma.globalCommand.delete({ where: { id: params.id } });

    // キャッシュ無効化
    await activeCache.delete(CACHE_KEY.globalCmd(command.oaId));

    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
});
