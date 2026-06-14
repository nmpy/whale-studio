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

    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    // work レベルの LIFF 有効/無効を尊重。preview=1 は CMS プレビュー継続のため通す。
    if (!preview && (work as { liffEnabled?: boolean }).liffEnabled === false) {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_DISABLED", message: "このLIFFは現在無効になっています" } },
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

    // キャラクター一覧ブロック (character_list) 用に、作品の有効キャラクターを同梱する。
    // CharacterInfo 形状（id/name/icon_*）。renderer の ctx.characters に流す。
    const characters = await prisma.character.findMany({
      where:   { workId: work.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select:  { id: true, name: true, iconType: true, iconText: true, iconImageUrl: true, iconColor: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        work_id:        work.id,
        work_title:     work.title,
        page_id:        config.id,
        public_id:      config.publicId,
        title:          config.title,
        description:    config.description,
        page_type:      config.pageType,
        publish_status: config.publishStatus,
        is_enabled:     config.isEnabled,
        settings_json:  config.settingsJson,
        characters: characters.map((c) => ({
          id:             c.id,
          name:           c.name,
          icon_type:      c.iconType,
          icon_text:      c.iconText,
          icon_image_url: c.iconImageUrl,
          icon_color:     c.iconColor,
        })),
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
