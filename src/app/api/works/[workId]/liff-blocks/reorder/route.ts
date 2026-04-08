// src/app/api/works/[workId]/liff-blocks/reorder/route.ts
// POST /api/works/[workId]/liff-blocks/reorder — ブロック並び替え

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { reorderLiffBlocksSchema, formatZodErrors } from "@/lib/validations";
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
    const data = reorderLiffBlocksSchema.parse(body);

    // config 存在チェック
    const config = await prisma.liffPageConfig.findUnique({
      where: { workId },
      include: { blocks: { select: { id: true } } },
    });
    if (!config) return notFound("LiffPageConfig");

    // block_ids がすべてこの config に属しているか確認
    const existingIds = new Set(config.blocks.map((b) => b.id));
    for (const id of data.block_ids) {
      if (!existingIds.has(id)) {
        return badRequest(`ブロック ${id} はこの作品に属していません`);
      }
    }

    // sort_order を更新
    await prisma.$transaction(
      data.block_ids.map((id, index) =>
        prisma.liffPageBlock.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    // 更新後のブロック一覧を返す
    const blocks = await prisma.liffPageBlock.findMany({
      where: { pageConfigId: config.id },
      orderBy: { sortOrder: "asc" },
    });

    return ok(blocks.map(toBlockResponse));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
