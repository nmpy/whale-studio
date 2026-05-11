// src/app/api/works/[workId]/liff-pages/route.ts
// GET  /api/works/[workId]/liff-pages  — 作品配下の LIFF ページ一覧 (メタデータのみ)
// POST /api/works/[workId]/liff-pages  — LIFF ページ新規作成
//
// 旧 /api/works/[workId]/liff-config はそのまま残し、後方互換用に「最初のページ」を返す。

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, created, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createLiffPageSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

const DEFAULT_NEW_TITLE = "新規ページ";

// ── GET ─────────────────────────────────────────
// 一覧表示用にメタデータのみ返す (blocks は含めない)。
export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const pages = await prisma.liffPageConfig.findMany({
      where: { workId },
      orderBy: { createdAt: "asc" },
      select: {
        id:            true,
        workId:        true,
        title:         true,
        description:   true,
        pageType:      true,
        publishStatus: true,
        isEnabled:     true,
        createdAt:     true,
        updatedAt:     true,
      },
    });

    return ok({
      work_id: workId,
      pages: pages.map((p) => ({
        id:             p.id,
        work_id:        p.workId,
        title:          p.title,
        description:    p.description,
        page_type:      p.pageType,
        publish_status: p.publishStatus,
        is_enabled:     p.isEnabled,
        created_at:     p.createdAt,
        updated_at:     p.updatedAt,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

// ── POST ────────────────────────────────────────
// 新規 LIFF ページを作成し、作成後のレコード (blocks 空) を返す。
// 初期値:
//   - title: "新規ページ" (req で省略可)
//   - page_type: "default"
//   - publish_status: "draft"
//   - is_enabled: false
export const POST = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json().catch(() => ({}));
    const data = createLiffPageSchema.parse(body);

    const page = await prisma.liffPageConfig.create({
      data: {
        workId,
        title:         (data.title?.trim() || DEFAULT_NEW_TITLE),
        description:   data.description ?? null,
        pageType:      data.page_type ?? "default",
        publishStatus: "draft",
        isEnabled:     false,
        settingsJson:  {} as Prisma.InputJsonValue,
      },
    });

    return created({
      id:             page.id,
      work_id:        page.workId,
      title:          page.title,
      description:    page.description,
      page_type:      page.pageType,
      publish_status: page.publishStatus,
      is_enabled:     page.isEnabled,
      settings_json:  page.settingsJson,
      blocks:         [],
      created_at:     page.createdAt,
      updated_at:     page.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
