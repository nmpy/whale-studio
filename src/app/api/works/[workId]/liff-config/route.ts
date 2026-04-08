// src/app/api/works/[workId]/liff-config/route.ts
// GET  /api/works/[workId]/liff-config — LIFF設定取得（blocks含む）
// PUT  /api/works/[workId]/liff-config — LIFF設定更新（upsert）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateLiffConfigSchema, formatZodErrors } from "@/lib/validations";
import { toConfigResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

// ── GET ─────────────────────────────────────────
export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    let config = await prisma.liffPageConfig.findUnique({
      where: { workId },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });

    // 未作成なら空のデフォルトを返す
    if (!config) {
      config = await prisma.liffPageConfig.create({
        data: { workId, isEnabled: false },
        include: { blocks: { orderBy: { sortOrder: "asc" } } },
      });
    }

    return ok(toConfigResponse(config));
  } catch (err) {
    return serverError(err);
  }
});

// ── PUT ─────────────────────────────────────────
export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateLiffConfigSchema.parse(body);

    const config = await prisma.liffPageConfig.upsert({
      where: { workId },
      create: {
        workId,
        isEnabled:   data.is_enabled ?? false,
        title:       data.title ?? null,
        description: data.description ?? null,
      },
      update: {
        ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
      },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });

    return ok(toConfigResponse(config));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
