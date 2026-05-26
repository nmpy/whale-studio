// src/app/api/works/[workId]/liff-pages/[pageId]/route.ts
// GET    /api/works/[workId]/liff-pages/[pageId]  — LIFF ページ詳細 (blocks 含む)
// PUT    /api/works/[workId]/liff-pages/[pageId]  — LIFF ページ更新
// DELETE /api/works/[workId]/liff-pages/[pageId]  — LIFF ページ削除

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, noContent, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { updateLiffConfigSchema, formatZodErrors, validatePublishRequirements } from "@/lib/validations";
import { toConfigResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

async function loadPage(workId: string, pageId: string) {
  const page = await prisma.liffPageConfig.findFirst({
    where: { id: pageId, workId },
    include: {
      blocks: { orderBy: { sortOrder: "asc" } },
      work: { select: { publicId: true } },
    },
  });
  return page;
}

// ── GET ─────────────────────────────────────────
export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId, pageId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const page = await loadPage(workId, pageId);
    if (!page) return notFound("LiffPage");

    return ok(toConfigResponse(page));
  } catch (err) {
    return serverError(err);
  }
});

// ── PUT ─────────────────────────────────────────
// editor 以上 = 編集 / draft 操作
// admin  以上 = publish_status を "published" / "archived" に変更
export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId, pageId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // プラン制限: LIFF表示設定は Plus プラン以上
    const planGuard = await requirePlanFeature({ oaId, featureKey: FEATURE.liffDisplay });
    if (!planGuard.ok) return planGuard.response;

    const existing = await loadPage(workId, pageId);
    if (!existing) return notFound("LiffPage");

    const body = await req.json();
    const data = updateLiffConfigSchema.parse(body);

    if (data.publish_status && data.publish_status !== "draft") {
      const adminCheck = await requireRole(oaId, user.id, "admin");
      if (!adminCheck.ok) return adminCheck.response;
    }

    if (data.publish_status === "published") {
      const settings = data.settings_json ?? (existing.settingsJson as Record<string, unknown> | undefined) ?? {};
      const title = data.title ?? existing.title ?? null;
      const pageType = data.page_type ?? existing.pageType ?? "default";
      const blocks = existing.blocks.map((b) => ({
        blockType:    b.blockType,
        title:        b.title,
        settingsJson: b.settingsJson,
      }));
      const v = validatePublishRequirements({ title, pageType, settings, blocks });
      if (!v.ok) {
        return badRequest("公開できません: " + v.errors.join(" / "));
      }
    }

    const updated = await prisma.liffPageConfig.update({
      where: { id: pageId },
      data: {
        ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.page_type !== undefined && { pageType: data.page_type }),
        ...(data.publish_status !== undefined && { publishStatus: data.publish_status }),
        ...(data.settings_json !== undefined && { settingsJson: data.settings_json as Prisma.InputJsonValue }),
      },
      include: {
        blocks: { orderBy: { sortOrder: "asc" } },
        work: { select: { publicId: true } },
      },
    });

    return ok(toConfigResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});

// ── DELETE ──────────────────────────────────────
// admin 以上のみ。
// UI 上では現在この DELETE を呼ぶ導線を出していない (初期スコープ外)。
// 将来追加するときは UI 側に必ず確認ダイアログ (window.confirm 等) を入れること。
export const DELETE = withAuth(async (req, ctx, user) => {
  try {
    const { workId, pageId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "admin");
    if (!check.ok) return check.response;

    // プラン制限: LIFF表示設定は Plus プラン以上
    const planGuard = await requirePlanFeature({ oaId, featureKey: FEATURE.liffDisplay });
    if (!planGuard.ok) return planGuard.response;

    const existing = await loadPage(workId, pageId);
    if (!existing) return notFound("LiffPage");

    await prisma.liffPageConfig.delete({ where: { id: pageId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
