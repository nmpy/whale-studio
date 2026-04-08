// src/app/api/works/[workId]/destinations/route.ts
// GET  /api/works/[workId]/destinations — destination 一覧
// POST /api/works/[workId]/destinations — destination 作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, created, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createDestinationSchema, formatZodErrors } from "@/lib/validations";
import { toDestinationResponse } from "@/lib/destination-utils";
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

    const destinations = await prisma.lineDestination.findMany({
      where: { workId },
      orderBy: [{ createdAt: "asc" }],
    });

    return ok(destinations.map(toDestinationResponse));
  } catch (err) {
    return serverError(err);
  }
});

// ── POST ────────────────────────────────────────
export const POST = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = createDestinationSchema.parse({ ...body, work_id: workId });

    // key 重複チェック
    const existing = await prisma.lineDestination.findUnique({
      where: { workId_key: { workId, key: data.key } },
    });
    if (existing) {
      return conflict(`key "${data.key}" はこの作品で既に使われています`);
    }

    const dest = await prisma.lineDestination.create({
      data: {
        workId,
        key:             data.key,
        name:            data.name,
        description:     data.description ?? null,
        destinationType: data.destination_type,
        liffTargetType:  data.liff_target_type ?? null,
        urlOrPath:       data.url_or_path ?? null,
        queryParamsJson: (data.query_params_json ?? {}) as Prisma.InputJsonValue,
        isEnabled:       data.is_enabled ?? true,
      },
    });

    return created(toDestinationResponse(dest));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
