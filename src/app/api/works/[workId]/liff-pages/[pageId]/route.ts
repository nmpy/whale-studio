// src/app/api/works/[workId]/liff-pages/[pageId]/route.ts
// GET    /api/works/[workId]/liff-pages/[pageId]  — LIFF ページ詳細 (blocks 含む)
// PUT    /api/works/[workId]/liff-pages/[pageId]  — LIFF ページ更新
// DELETE /api/works/[workId]/liff-pages/[pageId]  — LIFF ページ削除

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, noContent, conflict, unprocessable, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { updateLiffConfigSchema, formatZodErrors, validatePublishRequirements } from "@/lib/validations";
import { getLiffPageDeleteBlockReason, LIFF_PAGE_DELETE_MESSAGES } from "@/lib/liff-page-delete";
import { toConfigResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

/**
 * PR-B: 削除対象ページを他の設定が参照していないか集計する。
 *   - button_link ブロック（他ページ）の settings_json.liff_page_id がこのページを指す
 *   - Message の image_action_liff_page_id がこのページを指す（画像タップで開く LIFF ページ）
 * いずれも FK 無し（= cascade されず孤児化する）ため、参照があれば削除を拒否する。
 */
async function countLiffPageReferences(pageId: string): Promise<number> {
  const [blockRefs, messageRefs] = await Promise.all([
    prisma.liffPageBlock.count({
      where: {
        blockType:    "button_link",
        pageConfigId: { not: pageId }, // 自ページのブロックは cascade されるので除外
        settingsJson: { path: ["liff_page_id"], equals: pageId },
      },
    }),
    prisma.message.count({ where: { imageActionLiffPageId: pageId } }),
  ]);
  return blockRefs + messageRefs;
}

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
// admin 以上のみの「完全削除」（復元不可）。アーカイブ（PUT publish_status="archived"）とは別操作。
// 安全ガード（PR-B）:
//   - 公開中（published）は削除不可（409）。先に非公開 / アーカイブする。
//   - 他設定から参照中（button_link.liff_page_id / Message.image_action_liff_page_id）は削除不可（422）。
//   - 自ページの blocks / submissions 等は schema 上 cascade されるので一緒に削除される。
//   - UI 側でも確認ダイアログ + 公開中ボタン無効化を行う（多層防御）。
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

    // 公開中は参照チェック前に拒否（先に非公開 / アーカイブを促す）。
    if (existing.publishStatus === "published") {
      return conflict(LIFF_PAGE_DELETE_MESSAGES.published);
    }

    // 他設定からの参照があれば削除不可。
    const referenceCount = await countLiffPageReferences(pageId);
    const reason = getLiffPageDeleteBlockReason({
      publishStatus: existing.publishStatus,
      referenceCount,
    });
    if (reason === "referenced") {
      return unprocessable(LIFF_PAGE_DELETE_MESSAGES.referenced, "LIFF_PAGE_REFERENCED");
    }

    await prisma.liffPageConfig.delete({ where: { id: pageId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
