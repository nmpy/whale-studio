// src/app/api/liff/works/[workId]/werewolf/titles/route.ts
//
// プレイヤー側公開 API — 1 つの LiffPageConfig (pageType="werewolf") 配下の
// タイトル一覧を返す。
//
// セキュリティ:
//   - 認証なし。token (slot) を持たないユーザーが見える情報は **「タイトル名 / 日時 / 開始状態」のみ**。
//   - slot / card のデータは絶対に返さない (= 役職ネタバレ防止)。GM 側 API のみで取り扱う。
//   - 公開済みの LIFF ページ配下のみ返す (publish_status === "published")。
//     ?preview=1 で draft も返す (CMS プレビュー用)。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId: workIdOrPublic } = await ctx.params;
    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ページを読み込めませんでした" } },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";
    const liffPageConfigId = url.searchParams.get("liff_page_config_id");

    if (!liffPageConfigId) {
      return NextResponse.json(
        { success: false, error: { code: "BAD_REQUEST", message: "liff_page_config_id クエリが必須です" } },
        { status: 400 }
      );
    }

    // work レベル LIFF 無効 / 該当 page が無効ならアクセス不可
    if (!preview && (work as { liffEnabled?: boolean }).liffEnabled === false) {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_DISABLED", message: "このLIFFは現在無効になっています" } },
        { status: 404 }
      );
    }

    const pageConfig = await prisma.liffPageConfig.findUnique({
      where:  { id: liffPageConfigId },
      select: { id: true, workId: true, isEnabled: true, publishStatus: true, pageType: true },
    });
    if (!pageConfig || pageConfig.workId !== work.id) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "LIFF ページが見つかりません" } },
        { status: 404 }
      );
    }
    if (!pageConfig.isEnabled) {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_DISABLED", message: "このLIFFページは無効です" } },
        { status: 404 }
      );
    }
    if (!preview && pageConfig.publishStatus !== "published") {
      return NextResponse.json(
        { success: false, error: { code: "LIFF_NOT_PUBLISHED", message: "このLIFFページはまだ公開されていません" } },
        { status: 404 }
      );
    }

    const titles = await prisma.werewolfTitle.findMany({
      where:   { liffPageConfigId, workId: work.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id:          true,
        publicId:    true,
        title:       true,
        description: true,
        scheduledAt: true,
        isStarted:   true,
        startedAt:   true,
        playerCount: true,
        createdAt:   true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        work_id:             work.id,
        liff_page_config_id: pageConfig.id,
        titles: titles.map((t) => ({
          id:           t.id,
          public_id:    t.publicId,
          title:        t.title,
          description:  t.description,
          scheduled_at: t.scheduledAt,
          is_started:   t.isStarted,
          // started_at は意図的に省略 (プレイヤー側で必要な情報ではない)
          player_count: t.playerCount,
          created_at:   t.createdAt,
        })),
      },
    });
  } catch (err) {
    console.error("[LIFF Werewolf Titles API Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
