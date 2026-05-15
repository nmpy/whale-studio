// src/app/api/liff/works/[workId]/menu/route.ts
// GET /api/liff/works/[workId]/menu — 作品メニュー shell 用公開API（認証不要）
//
// 1 つの work 配下の **全 LiffPageConfig を 1 リクエストで返す** ためのエンドポイント。
// 旧 /api/liff/works/[workId] (= 最古ページ 1 件) や
//     /api/liff/works/[workId]/pages/[pageId] (= 特定 1 件) は引き続き存在するが、
// プレイヤー画面側はこの menu エンドポイントを使ってタブ UI を構築する。
//
// 仕様:
//   - ?preview=1 のときは publishStatus=draft も含める (CMS プレビュー用)
//   - is_enabled=false の page は除外
//   - blocks は各 page の is_enabled=true のみ、sort_order asc で同梱
//   - 並び替えはクライアント側 (buildMenuTabs) に任せる — API はあくまで raw を返す

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
        { success: false, error: { code: "NOT_FOUND", message: "ページを読み込めませんでした。URLが正しいか確認してください。" } },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    const configs = await prisma.liffPageConfig.findMany({
      where: {
        workId: work.id,
        isEnabled: true,
        ...(preview ? {} : { publishStatus: "published" }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        blocks: {
          where: { isEnabled: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (configs.length === 0) {
      // 公開済み (or preview 込み) のページが 1 件も無い場合は、404 ではなく空配列を返す。
      // プレイヤー側で「メニュー項目がありません」の空状態を表示できるようにする。
      return NextResponse.json({
        success: true,
        data: {
          work_id:    work.id,
          work_title: work.title,
          pages:      [],
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        work_id:    work.id,
        work_title: work.title,
        pages: configs.map((config) => ({
          id:             config.id,
          public_id:      config.publicId,
          title:          config.title,
          description:    config.description,
          page_type:      config.pageType,
          publish_status: config.publishStatus,
          is_enabled:     config.isEnabled,
          settings_json:  config.settingsJson,
          blocks: config.blocks.map((b) => ({
            id:                        b.id,
            block_type:                b.blockType,
            sort_order:                b.sortOrder,
            title:                     b.title,
            settings_json:             b.settingsJson,
            visibility_condition_json: b.visibilityConditionJson,
          })),
        })),
      },
    });
  } catch (err) {
    console.error("[LIFF Menu API Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
