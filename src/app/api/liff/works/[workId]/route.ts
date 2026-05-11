// src/app/api/liff/works/[workId]/route.ts
// GET /api/liff/works/[workId] — LIFF表示用公開API（認証不要）
// LIFF側から呼ばれる。有効なブロックのみ返す。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId } = await ctx.params;

    const work = await prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, title: true, publishStatus: true, oaId: true },
    });
    if (!work) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "作品が見つかりません" } },
        { status: 404 }
      );
    }

    // 複数 LIFF ページ対応: workId だけで指定された場合は、最も古い (oldest) ページを返す。
    // 新仕様の URL は /api/liff/works/[workId]/pages/[pageId] を使うこと。
    // createdAt 同値時のタイブレークに id を併用して安定ソートにする。
    const config = await prisma.liffPageConfig.findFirst({
      where: { workId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        blocks: {
          where: { isEnabled: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    // ?preview=1 が指定されているとき（管理画面プレビュー用）は draft でも返す。
    // 通常は published のみ。is_enabled=false は LIFF 自体無効として 404。
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
