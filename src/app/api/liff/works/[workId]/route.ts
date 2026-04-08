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

    const config = await prisma.liffPageConfig.findUnique({
      where: { workId },
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

    return NextResponse.json({
      success: true,
      data: {
        work_id:     work.id,
        work_title:  work.title,
        title:       config.title,
        description: config.description,
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
