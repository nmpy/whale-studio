// src/app/api/works/[workId]/werewolf/titles/route.ts
//
// GM 側 (CMS) で人狼モードのタイトルを一覧・作成する API。
//
// Phase 1 スコープ:
//   - GET  : タイトル一覧 (slots は含めない。一覧画面用の軽量レスポンス)
//   - POST : タイトル新規作成。player_count に応じて WerewolfRoleSlot を auto-generate する。
//
// Phase 2 以降で別ファイルに分けて追加するもの:
//   - 詳細取得 (slots + cards 含む)
//   - 更新 (title / description / scheduledAt / playerCount)
//   - 削除
//   - ゲーム開始 POST
//   - slot / card CRUD + 並び替え

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createWerewolfTitleSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

// ── GET /api/works/[workId]/werewolf/titles ─────────────────────────────────
// クエリ: ?liff_page_config_id=xxx を必須にして、特定 LIFF ページ配下のタイトルだけ返す。
// 省略時は work 全体 (= 複数の werewolf LiffPageConfig がある場合の総一覧) を返す。
export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const url = new URL(req.url);
    const liffPageConfigId = url.searchParams.get("liff_page_config_id");

    const titles = await prisma.werewolfTitle.findMany({
      where: {
        workId,
        ...(liffPageConfigId ? { liffPageConfigId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return ok({
      work_id: workId,
      titles: titles.map((t) => ({
        id:                  t.id,
        public_id:           t.publicId,
        liff_page_config_id: t.liffPageConfigId,
        work_id:             t.workId,
        title:               t.title,
        description:         t.description,
        scheduled_at:        t.scheduledAt,
        player_count:        t.playerCount,
        is_started:          t.isStarted,
        started_at:          t.startedAt,
        sort_order:          t.sortOrder,
        created_at:          t.createdAt,
        updated_at:          t.updatedAt,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

// ── POST /api/works/[workId]/werewolf/titles ────────────────────────────────
// 新規タイトル + プレイヤー人数分の空 slot を 1 トランザクションで作成する。
// 各 slot の token は PG 関数 gen_unique_public_id() で自動採番される。
// cards は MVP では作成しない (Phase 2 で GM が後から追加する想定)。
export const POST = withAuth(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = createWerewolfTitleSchema.parse(body);

    // 指定された LiffPageConfig が本当に同じ work のものかをチェック (テナント分離)
    const pageConfig = await prisma.liffPageConfig.findUnique({
      where: { id: data.liff_page_config_id },
      select: { id: true, workId: true, pageType: true },
    });
    if (!pageConfig || pageConfig.workId !== workId) {
      return badRequest("指定された LIFF ページが見つかりません");
    }
    if (pageConfig.pageType !== "werewolf") {
      return badRequest("LIFF ページ種別が 'werewolf' ではありません");
    }

    // トランザクション: タイトル + slot を同時作成
    const result = await prisma.$transaction(async (tx) => {
      const t = await tx.werewolfTitle.create({
        data: {
          liffPageConfigId: data.liff_page_config_id,
          workId,
          title:            data.title,
          description:      data.description ?? null,
          scheduledAt:      data.scheduled_at ? new Date(data.scheduled_at) : null,
          playerCount:      data.player_count,
          isStarted:        false,
        },
      });

      // player_count 分の slot を auto-generate。
      // slot_number は 1-indexed で連番。token は default(gen_unique_public_id) で発番される。
      if (data.player_count > 0) {
        await tx.werewolfRoleSlot.createMany({
          data: Array.from({ length: data.player_count }, (_, i) => ({
            titleId:    t.id,
            slotNumber: i + 1,
            label:      `プレイヤー${i + 1}`,
          })) as Prisma.WerewolfRoleSlotCreateManyInput[],
        });
      }

      return t;
    });

    return created({
      id:                  result.id,
      public_id:           result.publicId,
      liff_page_config_id: result.liffPageConfigId,
      work_id:             result.workId,
      title:               result.title,
      description:         result.description,
      scheduled_at:        result.scheduledAt,
      player_count:        result.playerCount,
      is_started:          result.isStarted,
      started_at:          result.startedAt,
      sort_order:          result.sortOrder,
      created_at:          result.createdAt,
      updated_at:          result.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
