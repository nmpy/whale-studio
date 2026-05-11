// src/app/api/works/[workId]/liff-config/route.ts
// GET  /api/works/[workId]/liff-config — LIFF設定取得（blocks含む）
// PUT  /api/works/[workId]/liff-config — LIFF設定更新（upsert）
//
// [後方互換] 旧仕様 (work 単位の単一 LIFF 設定) を保つためのエンドポイント。
// 複数 LIFF ページに移行した後は、ここでは作品配下で最も古い (oldest) ページを対象とする。
// 新規 UI は /api/works/[workId]/liff-pages 系を使うこと。

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateLiffConfigSchema, formatZodErrors, validatePublishRequirements } from "@/lib/validations";
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

    // workId に紐づく最も古いページを返す (旧 single-config 互換)。
    // createdAt が同値の場合に備えて id でタイブレークし、安定ソートにする。
    let config = await prisma.liffPageConfig.findFirst({
      where: { workId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });

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
// editor 以上 = 設定の作成・編集 / draft 操作
// admin  以上 = publish_status を "published" / "archived" に変更
export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateLiffConfigSchema.parse(body);

    // 公開系操作は admin 以上を要求
    if (data.publish_status && data.publish_status !== "draft") {
      const adminCheck = await requireRole(oaId, user.id, "admin");
      if (!adminCheck.ok) return adminCheck.response;
    }

    // 対象は workId 配下の最も古いページ。無ければ作成する。
    const existing = await prisma.liffPageConfig.findFirst({
      where: { workId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { blocks: true },
    });

    if (data.publish_status === "published") {
      const settings = data.settings_json ?? (existing?.settingsJson as Record<string, unknown> | undefined) ?? {};
      const title = data.title ?? existing?.title ?? null;
      const pageType = data.page_type ?? existing?.pageType ?? "default";
      const blocks = (existing?.blocks ?? []).map((b) => ({
        blockType:    b.blockType,
        title:        b.title,
        settingsJson: b.settingsJson,
      }));
      const v = validatePublishRequirements({ title, pageType, settings, blocks });
      if (!v.ok) {
        return badRequest("公開できません: " + v.errors.join(" / "));
      }
    }

    const config = existing
      ? await prisma.liffPageConfig.update({
          where: { id: existing.id },
          data: {
            ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
            ...(data.title !== undefined && { title: data.title }),
            ...(data.description !== undefined && { description: data.description }),
            ...(data.page_type !== undefined && { pageType: data.page_type }),
            ...(data.publish_status !== undefined && { publishStatus: data.publish_status }),
            ...(data.settings_json !== undefined && { settingsJson: data.settings_json as Prisma.InputJsonValue }),
          },
          include: { blocks: { orderBy: { sortOrder: "asc" } } },
        })
      : await prisma.liffPageConfig.create({
          data: {
            workId,
            isEnabled:     data.is_enabled ?? false,
            title:         data.title ?? null,
            description:   data.description ?? null,
            pageType:      data.page_type ?? "default",
            publishStatus: data.publish_status ?? "draft",
            settingsJson:  (data.settings_json ?? {}) as Prisma.InputJsonValue,
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
