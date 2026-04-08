// src/app/api/works/[workId]/destinations/[destinationId]/route.ts
// PATCH  — destination 更新
// DELETE — destination 削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, badRequest, notFound, noContent, conflict, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateDestinationSchema, formatZodErrors } from "@/lib/validations";
import { toDestinationResponse } from "@/lib/destination-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

// ── PATCH ───────────────────────────────────────
export const PATCH = withAuth(async (req, ctx, user) => {
  try {
    const { workId, destinationId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // 存在 + 所属チェック
    const existing = await prisma.lineDestination.findUnique({
      where: { id: destinationId },
    });
    if (!existing || existing.workId !== workId) {
      return notFound("Destination");
    }

    const body = await req.json();
    const data = updateDestinationSchema.parse(body);

    // key 変更時の重複チェック
    if (data.key && data.key !== existing.key) {
      const dup = await prisma.lineDestination.findUnique({
        where: { workId_key: { workId, key: data.key } },
      });
      if (dup) {
        return conflict(`key "${data.key}" はこの作品で既に使われています`);
      }
    }

    const updated = await prisma.lineDestination.update({
      where: { id: destinationId },
      data: {
        ...(data.key !== undefined && { key: data.key }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.destination_type !== undefined && { destinationType: data.destination_type }),
        ...(data.liff_target_type !== undefined && { liffTargetType: data.liff_target_type }),
        ...(data.url_or_path !== undefined && { urlOrPath: data.url_or_path }),
        ...(data.query_params_json !== undefined && { queryParamsJson: data.query_params_json as Prisma.InputJsonValue }),
        ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
      },
    });

    return ok(toDestinationResponse(updated));
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
    const { workId, destinationId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await prisma.lineDestination.findUnique({
      where: { id: destinationId },
    });
    if (!existing || existing.workId !== workId) {
      return notFound("Destination");
    }

    await prisma.lineDestination.delete({ where: { id: destinationId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
