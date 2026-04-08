// src/app/api/works/[workId]/liff-blocks/route.ts
// POST /api/works/[workId]/liff-blocks — ブロック追加

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createLiffBlockSchema, validateBlockSettings, formatZodErrors } from "@/lib/validations";
import { toBlockResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = createLiffBlockSchema.parse(body);

    // settings_json のバリデーション
    const settingsCheck = validateBlockSettings(data.block_type, data.settings_json);
    if (!settingsCheck.success) {
      return badRequest("ブロック設定に誤りがあります", formatZodErrors(settingsCheck.error));
    }

    // LiffPageConfig がなければ自動作成
    let config = await prisma.liffPageConfig.findUnique({ where: { workId } });
    if (!config) {
      config = await prisma.liffPageConfig.create({
        data: { workId, isEnabled: false },
      });
    }

    // sort_order 自動計算（末尾に追加）
    const maxSort = await prisma.liffPageBlock.aggregate({
      where: { pageConfigId: config.id },
      _max: { sortOrder: true },
    });
    const nextSort = data.sort_order ?? ((maxSort._max.sortOrder ?? -1) + 1);

    const block = await prisma.liffPageBlock.create({
      data: {
        pageConfigId:            config.id,
        blockType:               data.block_type,
        sortOrder:               nextSort,
        isEnabled:               data.is_enabled ?? true,
        title:                   data.title ?? null,
        settingsJson:            (data.settings_json ?? {}) as Prisma.InputJsonValue,
        visibilityConditionJson: data.visibility_condition_json ?? null,
      },
    });

    return created(toBlockResponse(block));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
