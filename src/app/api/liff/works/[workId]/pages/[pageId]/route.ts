// src/app/api/liff/works/[workId]/pages/[pageId]/route.ts
// GET /api/liff/works/[workId]/pages/[pageId] — LIFF表示用公開API（認証不要）
// 指定された LIFF ページ ID と workId の組み合わせで配信内容を返す。
// publish_status の制御は ?preview=1 で旧 /api/liff/works/[workId] と同等。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId, findLiffPageConfigByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string; pageId: string }> }
) {
  try {
    const { workId: workIdOrPublic, pageId: pageIdOrPublic } = await ctx.params;

    // workId / pageId はそれぞれ UUID か publicId のどちらでも受け付ける
    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) {
      console.error(`[LIFF API] Work not found: workIdOrPublic=${workIdOrPublic}`);
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ページを読み込めませんでした。URLが正しいか確認してください。" } },
        { status: 404 }
      );
    }

    // page は work に属していることも検証 (テナント分離)
    const configMeta = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
    if (!configMeta) {
      console.error(`[LIFF API] LIFF page not found or wrong work: workId=${work.id} pageIdOrPublic=${pageIdOrPublic}`);
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ページを読み込めませんでした。URLが正しいか確認してください。" } },
        { status: 404 }
      );
    }

    // blocks 込みで再取得 (resolver は blocks を含まないため)
    const config = await prisma.liffPageConfig.findUnique({
      where: { id: configMeta.id },
      include: {
        blocks: {
          where: { isEnabled: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    if (!config || !config.isEnabled) {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_DISABLED", message: "このLIFFページは無効です" } },
        { status: 404 }
      );
    }
    if (!preview && config.publishStatus !== "published") {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_NOT_PUBLISHED", message: "このLIFFページはまだ公開されていません" } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        work_id:        work.id,
        work_title:     work.title,
        page_id:        config.id,
        title:          config.title,
        description:    config.description,
        page_type:      config.pageType,
        publish_status: config.publishStatus,
        settings_json:  config.settingsJson,
        blocks: config.blocks.map((b) => ({
          id:                        b.id,
          block_type:                b.blockType,
          sort_order:                b.sortOrder,
          title:                     b.title,
          settings_json:             b.settingsJson,
          visibility_condition_json: b.visibilityConditionJson,
        })),
      },
    });
  } catch (err) {
    console.error("[LIFF API Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
