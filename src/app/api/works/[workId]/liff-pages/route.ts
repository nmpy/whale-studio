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
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
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
        publicId:      true,
        workId:        true,
        work:          { select: { publicId: true } },
        title:         true,
        description:   true,
        pageType:      true,
        publishStatus: true,
        isEnabled:     true,
        settingsJson:  true,
        createdAt:     true,
        updatedAt:     true,
      },
    });

    // 回答数バッジ用に submission 件数を 1 クエリで集計する（N+1 を避ける）。
    // ※ migration 未適用（liff_submissions 未作成）でも既存の一覧表示を壊さないよう、
    //   集計失敗は count=0 にフォールバックする（deploy が migration より先行しても安全）。
    const countByPage = new Map<string, number>();
    try {
      const counts = await prisma.liffSubmission.groupBy({
        by: ["liffPageId"],
        where: { workId },
        _count: { _all: true },
      });
      for (const c of counts) countByPage.set(c.liffPageId, c._count._all);
    } catch (e) {
      console.warn("[liff-pages] submission count skipped (table may be pre-migration):", e);
    }

    return ok({
      work_id: workId,
      pages: pages.map((p) => {
        // settingsJson から作品メニューホーム関連の per-page 設定を導出する。
        // タブ分類 (詳細/独立)・並び順・表示形式の判定に使う。既存フィールドは維持 (API 互換)。
        const s = (p.settingsJson ?? {}) as {
          show_in_menu?: boolean;
          menu_order?: number;
          menu_label?: string;
          menu_icon?: string;
          menu_card_style?: "card" | "compact";
        };
        return {
          id:              p.id,
          public_id:       p.publicId,
          work_id:         p.workId,
          work_public_id:  p.work?.publicId,
          title:           p.title,
          description:     p.description,
          page_type:       p.pageType,
          publish_status:  p.publishStatus,
          is_enabled:      p.isEnabled,
          submission_count: countByPage.get(p.id) ?? 0,
          // ── 作品メニューホーム用 (追加フィールド) ──
          // show_in_menu 未指定 = true 扱い (= 詳細ページ)。renderer の isShownInMenu と整合。
          show_in_menu:    s.show_in_menu !== false,
          menu_order:      s.menu_order ?? null,
          menu_label:      s.menu_label ?? null,
          menu_icon:       s.menu_icon ?? null,
          // 未指定は "card" 扱い (= 既存ページの表示を変えない)。
          menu_card_style: s.menu_card_style === "compact" ? "compact" : "card",
          created_at:      p.createdAt,
          updated_at:      p.updatedAt,
        };
      }),
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

    // プラン制限: LIFF表示設定は Plus プラン以上
    const planGuard = await requirePlanFeature({ oaId, featureKey: FEATURE.liffDisplay });
    if (!planGuard.ok) return planGuard.response;

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
      include: { work: { select: { publicId: true } } },
    });

    return created({
      id:              page.id,
      public_id:       page.publicId,
      work_id:         page.workId,
      work_public_id:  page.work?.publicId,
      title:           page.title,
      description:     page.description,
      page_type:       page.pageType,
      publish_status:  page.publishStatus,
      is_enabled:      page.isEnabled,
      settings_json:   page.settingsJson,
      blocks:          [],
      created_at:      page.createdAt,
      updated_at:      page.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
