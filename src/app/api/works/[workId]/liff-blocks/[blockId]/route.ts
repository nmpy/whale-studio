// src/app/api/works/[workId]/liff-blocks/[blockId]/route.ts
// PATCH  /api/works/[workId]/liff-blocks/[blockId] — ブロック更新
// DELETE /api/works/[workId]/liff-blocks/[blockId] — ブロック削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, badRequest, notFound, noContent, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateLiffBlockSchema, validateBlockSettings, formatZodErrors } from "@/lib/validations";
import { toBlockResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

// ── PATCH ───────────────────────────────────────
export const PATCH = withAuth(async (req, ctx, user) => {
  try {
    const { workId, blockId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // ブロック存在＋所属チェック
    const existing = await prisma.liffPageBlock.findUnique({
      where: { id: blockId },
      include: { pageConfig: { select: { workId: true } } },
    });
    if (!existing || existing.pageConfig.workId !== workId) {
      return notFound("LiffPageBlock");
    }

    const body = await req.json();
    const data = updateLiffBlockSchema.parse(body);

    // settings_json バリデーション（block_type は既存 or 更新後のもの）
    if (data.settings_json !== undefined) {
      const effectiveType = data.block_type ?? existing.blockType;
      const settingsCheck = validateBlockSettings(effectiveType, data.settings_json);
      if (!settingsCheck.success) {
        return badRequest("ブロック設定に誤りがあります", formatZodErrors(settingsCheck.error));
      }
    }

    const block = await prisma.liffPageBlock.update({
      where: { id: blockId },
      data: {
        ...(data.block_type !== undefined && { blockType: data.block_type }),
        ...(data.sort_order !== undefined && { sortOrder: data.sort_order }),
        ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.settings_json !== undefined && { settingsJson: data.settings_json as Prisma.InputJsonValue }),
        ...(data.visibility_condition_json !== undefined && { visibilityConditionJson: data.visibility_condition_json }),
      },
    });

    return ok(toBlockResponse(block));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});

// ── DELETE ──────────────────────────────────────
export const DELETE = withAuth(async (req, ctx, user) => {
  try {
    const { workId, blockId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // ブロック存在＋所属チェック
    const existing = await prisma.liffPageBlock.findUnique({
      where: { id: blockId },
      include: { pageConfig: { select: { workId: true } } },
    });
    if (!existing || existing.pageConfig.workId !== workId) {
      return notFound("LiffPageBlock");
    }

    await prisma.liffPageBlock.delete({ where: { id: blockId } });

    // sort_order を正規化
    const remaining = await prisma.liffPageBlock.findMany({
      where: { pageConfigId: existing.pageConfigId },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    await prisma.$transaction(
      remaining.map((b, i) =>
        prisma.liffPageBlock.update({ where: { id: b.id }, data: { sortOrder: i } })
      )
    );

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
