// src/app/api/works/[workId]/liff-config/route.ts
// GET  /api/works/[workId]/liff-config — LIFF設定取得（blocks含む）
// PUT  /api/works/[workId]/liff-config — LIFF設定更新（upsert）

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

const isDev = process.env.NODE_ENV !== "production";

/**
 * Prisma エラーを構造化して dev server ログに出すヘルパー。
 * 既存の `serverError(err)` が `[API Error]` としか出さないため、
 * Prisma error code / meta / message を別途 console.error する。
 */
function logRouteError(scope: string, ctx: Record<string, unknown>, err: unknown): void {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(`[liff-config ${scope}] Prisma known error`, {
      ...ctx,
      code:    err.code,
      meta:    err.meta,
      message: err.message,
    });
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    console.error(`[liff-config ${scope}] Prisma validation error`, {
      ...ctx,
      // schema と DB の型不一致 (NOT NULL なのに null が返ってきた等) はここに出る
      message: err.message,
    });
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error(`[liff-config ${scope}] Prisma init error`, {
      ...ctx,
      errorCode: err.errorCode,
      message:   err.message,
    });
  } else {
    console.error(`[liff-config ${scope}]`, ctx, err);
  }
}

/**
 * page_type / publish_status / settings_json が NULL のまま残っているレコードを修復する。
 * Supabase SQL Editor 等でカラム追加時に DEFAULT が反映されていないと、
 * Prisma の non-nullable schema では `findUnique` 自体が validation error で落ちる。
 * 落ちる前に raw SQL で NULL を埋めて再 fetch を可能にする。
 */
async function healNullColumns(workId: string): Promise<void> {
  // 該当 workId の行だけを対象にすることで、不要な書き込みを避ける
  await prisma.$executeRawUnsafe(`
    UPDATE "liff_page_configs"
       SET "page_type"      = COALESCE("page_type", 'default'),
           "publish_status" = COALESCE("publish_status", 'draft'),
           "settings_json"  = COALESCE("settings_json", '{}'::jsonb)
     WHERE "work_id" = $1
       AND ("page_type" IS NULL
            OR "publish_status" IS NULL
            OR "settings_json" IS NULL)
  `, workId);
}

// ── GET ─────────────────────────────────────────
export const GET = withAuth(async (req, ctx, user) => {
  const { workId } = await ctx.params;
  let oaId: string | null = null;
  try {
    oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    let config;
    try {
      config = await prisma.liffPageConfig.findUnique({
        where: { workId },
        include: { blocks: { orderBy: { sortOrder: "asc" } } },
      });
    } catch (err) {
      // schema(non-null) と DB(null) の不一致で findUnique が validation error で落ちるケース。
      // page_type / publish_status / settings_json を DEFAULT で埋めて 1 度だけリトライする。
      if (err instanceof Prisma.PrismaClientValidationError) {
        console.warn("[liff-config GET] findUnique validation error — attempting heal", { workId, oaId });
        await healNullColumns(workId);
        config = await prisma.liffPageConfig.findUnique({
          where: { workId },
          include: { blocks: { orderBy: { sortOrder: "asc" } } },
        });
      } else {
        throw err;
      }
    }

    if (!config) {
      config = await prisma.liffPageConfig.create({
        data: { workId, isEnabled: false },
        include: { blocks: { orderBy: { sortOrder: "asc" } } },
      });
    }

    return ok(toConfigResponse(config));
  } catch (err) {
    logRouteError("GET", { workId, oaId, userId: user.id }, err);
    // dev のときだけ実エラーメッセージをクライアントに返してトーストで原因が見えるようにする
    if (isDev && err instanceof Error) {
      return badRequest(`[dev] ${err.name}: ${err.message}`);
    }
    return serverError(err);
  }
});

// ── PUT ─────────────────────────────────────────
// editor 以上 = 設定の作成・編集 / draft 操作
// admin  以上 = publish_status を "published" / "archived" に変更
export const PUT = withAuth(async (req, ctx, user) => {
  const { workId } = await ctx.params;
  let oaId: string | null = null;
  try {
    oaId = await getOaIdFromWorkId(workId);
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

    // 公開しようとしている場合は必須項目を検証
    if (data.publish_status === "published") {
      const existing = await prisma.liffPageConfig.findUnique({
        where: { workId },
        include: { blocks: true },
      });
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

    const config = await prisma.liffPageConfig.upsert({
      where: { workId },
      create: {
        workId,
        isEnabled:     data.is_enabled ?? false,
        title:         data.title ?? null,
        description:   data.description ?? null,
        pageType:      data.page_type ?? "default",
        publishStatus: data.publish_status ?? "draft",
        settingsJson:  (data.settings_json ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.page_type !== undefined && { pageType: data.page_type }),
        ...(data.publish_status !== undefined && { publishStatus: data.publish_status }),
        ...(data.settings_json !== undefined && { settingsJson: data.settings_json as Prisma.InputJsonValue }),
      },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });

    return ok(toConfigResponse(config));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    logRouteError("PUT", { workId, oaId, userId: user.id }, err);
    if (isDev && err instanceof Error) {
      return badRequest(`[dev] ${err.name}: ${err.message}`);
    }
    return serverError(err);
  }
});
