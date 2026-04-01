// src/app/api/rich-menus/[id]/apply/route.ts
// POST /api/rich-menus/:id/apply
//
// DB に保存されたカスタムリッチメニューを LINE に登録・適用する。
//
// 処理フロー:
//   1. DB から RichMenu + RichMenuArea + OA（channel_access_token）を取得
//   2. DB のエリア情報から RichMenuConfig を構築
//   3. applyRichMenuConfig() 共通関数を呼び出す
//      a. 旧 LINE メニューを削除（line_rich_menu_id があれば）
//      b. LINE API にメニュー作成
//      c. imageUrl があれば画像アップロード
//      d. チャンネルのデフォルトに設定
//   4. DB の line_rich_menu_id と Oa.richMenuId を更新
//
// エラーハンドリング:
//   各ステップで失敗した場合、失敗したステップ名と LINE API の実際の
//   エラーメッセージをレスポンスに含める（フロントのトーストに表示される）。

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/lib/api-response";
import {
  applyRichMenuConfig,
} from "@/lib/line-richmenu";
import type { RichMenuConfig, RichMenuArea as LineRichMenuArea } from "@/lib/line-richmenu";

// ── DB エリア → LINE RichMenuArea 変換 ──────────
function dbAreasToLineAreas(areas: {
  x: number; y: number; width: number; height: number;
  actionType: string; actionLabel: string;
  actionText: string | null; actionData: string | null; actionUri: string | null;
}[]): LineRichMenuArea[] {
  return areas.map((a) => {
    const bounds = { x: a.x, y: a.y, width: a.width, height: a.height };
    if (a.actionType === "postback") {
      return {
        bounds,
        action: {
          type:        "postback" as const,
          label:       a.actionLabel,
          data:        a.actionData ?? a.actionLabel,
          displayText: a.actionText ?? a.actionLabel,
        },
      };
    }
    if (a.actionType === "uri") {
      return {
        bounds,
        action: {
          type:  "uri" as const,
          label: a.actionLabel,
          uri:   a.actionUri ?? "https://line.me",
        },
      };
    }
    // message（デフォルト）
    return {
      bounds,
      action: {
        type:  "message" as const,
        label: a.actionLabel,
        text:  a.actionText ?? a.actionLabel,
      },
    };
  });
}

// ── エラーレスポンスヘルパー ─────────────────────
function applyError(step: string, err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[apply] ${step} 失敗:`, err);
  return NextResponse.json(
    {
      success: false,
      error: {
        code:    "APPLY_ERROR",
        step,
        message: `${step}に失敗しました: ${message}`,
      },
    },
    { status }
  );
}

// ── POST /api/rich-menus/:id/apply ────────────────
export const POST = withAuth<{ id: string }>(async (_req, { params }) => {

  // ── ステップ 1: DB からメニュー取得 ──
  let menu;
  try {
    menu = await prisma.richMenu.findUnique({
      where:   { id: params.id },
      include: {
        areas: { orderBy: { sortOrder: "asc" } },
        oa:    { select: { channelAccessToken: true } },
      },
    });
  } catch (err) {
    return applyError("DBからの取得", err);
  }

  if (!menu) return notFound("リッチメニュー");

  const token = menu.oa.channelAccessToken;
  console.log(`[apply] メニュー取得完了 id=${params.id} name="${menu.name}" areas=${menu.areas.length} size=${menu.size}`);

  // ── ステップ 2: エリアが空でないか確認 ──
  if (menu.areas.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code:    "APPLY_ERROR",
          step:    "バリデーション",
          message: "エリアが1つもありません。エディターでエリアを追加してから適用してください。",
        },
      },
      { status: 400 }
    );
  }

  // ── ステップ 3: RichMenuConfig 構築 ──
  let config: RichMenuConfig;
  try {
    const sizeH     = menu.size === "full" ? 1686 : 843;
    const lineAreas = dbAreasToLineAreas(menu.areas);
    config = {
      size:        { width: 2500, height: sizeH },
      selected:    true,
      name:        menu.name,
      chatBarText: menu.chatBarText,
      areas:       lineAreas,
    };
    console.log(`[apply] config 構築完了 size=2500x${sizeH} areas=${lineAreas.length}`);

    // ── デバッグ: DB エリア一覧（変換前）──
    console.log(`[apply][DEBUG] DB areas (変換前):`);
    for (const [i, a] of menu.areas.entries()) {
      console.log(
        `[apply][DEBUG]   [${i}] bounds=(${a.x},${a.y} ${a.width}x${a.height})`,
        `actionType="${a.actionType}"`,
        `label="${a.actionLabel}"`,
        `text=${a.actionText !== null ? `"${a.actionText}"` : "null"}`,
        `uri=${a.actionUri  !== null ? `"${a.actionUri}"` : "null"}`,
        `data=${a.actionData !== null ? `"${a.actionData}"` : "null"}`,
        `sortOrder=${a.sortOrder}`
      );
    }

    // ── デバッグ: LINE areas 一覧（変換後）──
    console.log(`[apply][DEBUG] LINE areas (変換後):`);
    for (const [i, area] of lineAreas.entries()) {
      const { bounds, action } = area;
      console.log(
        `[apply][DEBUG]   [${i}] bounds=(${bounds.x},${bounds.y} ${bounds.width}x${bounds.height})`,
        `action.type="${action.type}"`,
        action.type === "message"  ? `text="${action.text}"` :
        action.type === "uri"      ? `uri="${action.uri}"` :
        action.type === "postback" ? `data="${action.data}" displayText="${action.displayText ?? ""}"` : ""
      );
    }

    // ── デバッグ: LINE API 送信 JSON 全体 ──
    console.log(`[apply][DEBUG] LINE API送信JSON:`, JSON.stringify(config, null, 2));
  } catch (err) {
    return applyError("LINE設定の構築", err);
  }

  // ── ステップ 4: LINE API 適用（共通関数） ──
  let lineRichMenuId: string;
  let imageUploaded: boolean;
  try {
    const result = await applyRichMenuConfig({
      token,
      config,
      imageUrl:          menu.imageUrl,
      oldLineRichMenuId: menu.lineRichMenuId,
      setDefault:        true,
      logPrefix:         "[apply]",
    });
    lineRichMenuId = result.lineRichMenuId;
    imageUploaded  = result.imageUploaded;
  } catch (err) {
    return applyError("LINE APIへの適用", err);
  }

  // ── ステップ 5: DB 更新（line_rich_menu_id + Oa.richMenuId） ──
  try {
    await prisma.$transaction([
      prisma.richMenu.update({
        where: { id: params.id },
        data:  { lineRichMenuId },
      }),
      prisma.oa.update({
        where: { id: menu.oaId },
        data:  { richMenuId: lineRichMenuId },
      }),
    ]);
    console.log(`[apply] DB 更新完了 lineRichMenuId=${lineRichMenuId}`);
  } catch (err) {
    return applyError("DB更新", err);
  }

  return ok({
    rich_menu_id:      params.id,
    line_rich_menu_id: lineRichMenuId,
    applied:           true,
    image_uploaded:    imageUploaded,
  });
});
