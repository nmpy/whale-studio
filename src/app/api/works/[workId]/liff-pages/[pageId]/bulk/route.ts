// src/app/api/works/[workId]/liff-pages/[pageId]/bulk/route.ts
// PUT /api/works/[workId]/liff-pages/[pageId]/bulk
//   LIFF 編集画面の「すべての変更を保存」専用エンドポイント。
//   ページ設定（title / description / page_type / publish_status / settings_json / is_enabled）と
//   ブロック一覧を 1 リクエストで受け取り、DB トランザクションでまとめて保存する。
//   - blocks は「保存後にこのページに存在すべき全ブロック」を並び順で渡す
//   - 既存ブロック(id 一致)は update / 新規(id 無し or temp-)は create / payload に無い既存は delete
//   - 配列の index を sort_order に採用する
//   トランザクションのため、途中失敗時に半端な状態（一部だけ保存）にはならない。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import {
  bulkSaveLiffPageSchema,
  validateBlockSettings,
  validatePublishRequirements,
  formatZodErrors,
} from "@/lib/validations";
import { toConfigResponse } from "@/lib/liff-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

async function loadPage(workId: string, pageId: string) {
  return prisma.liffPageConfig.findFirst({
    where: { id: pageId, workId },
    include: {
      blocks: { orderBy: { sortOrder: "asc" } },
      work: { select: { publicId: true } },
    },
  });
}

export const PUT = withAuth<{ workId: string; pageId: string }>(async (req, ctx, user) => {
  try {
    const { workId, pageId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // プラン制限: LIFF表示設定は Plus プラン以上（既存 PUT と同じ）
    const planGuard = await requirePlanFeature({ oaId, featureKey: FEATURE.liffDisplay });
    if (!planGuard.ok) return planGuard.response;

    const existing = await loadPage(workId, pageId);
    if (!existing) return notFound("LiffPage");

    const data = bulkSaveLiffPageSchema.parse(await req.json());

    // 各ブロックの settings_json を検証（既存の単体追加 API と同じ関数を使う）。
    for (let i = 0; i < data.blocks.length; i++) {
      const b = data.blocks[i];
      const sc = validateBlockSettings(b.block_type, b.settings_json ?? {});
      if (!sc.success) {
        return badRequest(`ブロック設定に誤りがあります（${i + 1} 番目）`, formatZodErrors(sc.error));
      }
    }

    // publish_status の権限・要件チェック（既存 PUT と同じ方針。公開時は「保存後の」ブロックで判定）。
    if (data.publish_status && data.publish_status !== "draft") {
      const adminCheck = await requireRole(oaId, user.id, "admin");
      if (!adminCheck.ok) return adminCheck.response;
    }
    if (data.publish_status === "published") {
      const settings = data.settings_json ?? (existing.settingsJson as Record<string, unknown> | undefined) ?? {};
      const title = data.title ?? existing.title ?? null;
      const pageType = data.page_type ?? existing.pageType ?? "default";
      const blocks = data.blocks.map((b) => ({
        blockType:    b.block_type,
        title:        b.title ?? null,
        settingsJson: (b.settings_json ?? {}) as unknown,
      }));
      const v = validatePublishRequirements({ title, pageType, settings, blocks });
      if (!v.ok) return badRequest("公開できません: " + v.errors.join(" / "));
    }

    // 既存ブロック id 集合（このページに属するものだけ）。
    const existingIds = new Set(existing.blocks.map((b) => b.id));
    // payload で「既存として残す」id（= 既存ブロックと一致する id のみ）。temp- や未知 id は新規扱い。
    const keepIds = data.blocks
      .map((b) => b.id)
      .filter((id): id is string => !!id && existingIds.has(id));

    await prisma.$transaction(async (tx) => {
      // 1) ページ設定の更新（指定されたフィールドのみ）。
      await tx.liffPageConfig.update({
        where: { id: pageId },
        data: {
          ...(data.is_enabled !== undefined && { isEnabled: data.is_enabled }),
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.page_type !== undefined && { pageType: data.page_type }),
          ...(data.publish_status !== undefined && { publishStatus: data.publish_status }),
          ...(data.settings_json !== undefined && { settingsJson: data.settings_json as Prisma.InputJsonValue }),
        },
      });

      // 2) payload に存在しない既存ブロックを削除（notIn:[] は全件削除になる＝全消し時も正しい）。
      await tx.liffPageBlock.deleteMany({
        where: { pageConfigId: pageId, id: { notIn: keepIds } },
      });

      // 3) 並び順 = 配列 index。既存は update / 新規は create。
      for (let i = 0; i < data.blocks.length; i++) {
        const b = data.blocks[i];
        const isExisting = !!b.id && existingIds.has(b.id);
        const common = {
          blockType:               b.block_type,
          title:                   b.title ?? null,
          isEnabled:               b.is_enabled ?? true,
          settingsJson:            (b.settings_json ?? {}) as Prisma.InputJsonValue,
          visibilityConditionJson: b.visibility_condition_json ?? null,
          sortOrder:               i,
        };
        if (isExisting) {
          await tx.liffPageBlock.update({ where: { id: b.id! }, data: common });
        } else {
          await tx.liffPageBlock.create({ data: { pageConfigId: pageId, ...common } });
        }
      }
    });

    const saved = await loadPage(workId, pageId);
    if (!saved) return notFound("LiffPage");
    return ok(toConfigResponse(saved));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
