// src/app/api/rich-menus/[id]/apply/route.ts
// POST /api/rich-menus/:id/apply
//
// DB に保存されたカスタムリッチメニューを LINE に登録・適用する。
//
// 処理フロー:
//   1. DB から RichMenu + RichMenuArea + OA（channel_access_token）を取得
//   2. DB のエリア情報から RichMenuConfig を構築
//   3. applyRichMenuConfig() 共通関数を呼び出す
//      a. 旧メニューの実在確認 + 現 default の把握
//      b. 画像を取得して 1MB / MIME を送信前に検証
//      c. LINE API にメニュー作成
//      d. 画像アップロード（失敗は致命的）
//      e. 新メニューの read-back（存在 + 画像）
//      f. デフォルトに設定 + read-back
//      g. persist（= 本 route が渡す DB 更新。失敗時は旧 default へ rollback）
//      h. 旧メニュー削除（置き換え成功後の cleanup）
//   ※ 「新メニューが完全に利用可能になるまで旧メニューを削除しない」ため、
//      DB 更新は applyRichMenuConfig の内側（persist）で行う。
//
// エラーハンドリング:
//   各ステップで失敗した場合、失敗したステップ名と LINE API の実際の
//   エラーメッセージをレスポンスに含める（フロントのトーストに表示される）。

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/lib/api-response";
import { invalidateOaCacheById } from "@/lib/oa-cache";
import {
  applyRichMenuConfig,
  RichMenuApplyError,
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

/**
 * apply の失敗を運用者向けに返す。
 *
 * RichMenuApplyError なら **一次原因**（例: 画像が 1MB 超）を message に出す。
 * LINE API の二次エラー（400 "must upload richmenu image before applying it to user"）を
 * そのまま見せると原因が分からないため。
 * それ以外は従来の applyError にフォールバックし、既存のレスポンス契約を壊さない。
 */
function applyFailure(err: unknown) {
  if (!(err instanceof RichMenuApplyError)) return applyError("LINE APIへの適用", err);

  console.error(`[apply] stage=${err.stage} 失敗: ${err.message}`, {
    newRichMenuId: err.newLineRichMenuId ?? null,
    cleanup:  err.cleanup  ? (err.cleanup.ok  ? "ok" : `failed: ${err.cleanup.error}`)  : "none",
    rollback: err.rollback ? (err.rollback.attempted ? (err.rollback.ok ? "ok" : `failed: ${err.rollback.error}`) : "skipped") : "none",
  });

  // 画像の検証エラーは運用者の入力起因なので 400。
  const status = err.stage === "image_validation" ? 400 : 500;
  return NextResponse.json(
    {
      success: false,
      error: {
        code:    "APPLY_ERROR",
        step:    err.stage,
        message: err.operatorMessage,
        // 補償動作の結果は追加情報として返す（primary reason を上書きしない）。
        cleanup_ok:  err.cleanup?.ok ?? null,
        rollback_ok: err.rollback?.attempted ? err.rollback.ok : null,
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

  // ── ステップ 4: LINE API 適用 + DB 更新 ──
  // DB 更新は persist として applyRichMenuConfig の内側で実行する。
  // こうしないと「LINE default = 新 / DB = 旧」になったときに旧 default へ戻せない。
  let lineRichMenuId: string;
  let imageUploaded: boolean;
  let applyWarnings: string[] | undefined;
  try {
    const result = await applyRichMenuConfig({
      token,
      config,
      imageUrl:          menu.imageUrl,
      oldLineRichMenuId: menu.lineRichMenuId,
      setDefault:        true,
      logPrefix:         "[apply]",
      persist: async (newId) => {
        // line_rich_menu_id と Oa.richMenuId は必ず同一 transaction で更新する
        // （片方だけ更新された状態を作らない）。
        await prisma.$transaction([
          prisma.richMenu.update({ where: { id: params.id }, data: { lineRichMenuId: newId } }),
          prisma.oa.update({ where: { id: menu.oaId }, data: { richMenuId: newId } }),
        ]);
        // DB 更新後の read-back: 2 箇所が新 ID で揃っていること。
        const [dbMenu, dbOa] = await Promise.all([
          prisma.richMenu.findUnique({ where: { id: params.id }, select: { lineRichMenuId: true } }),
          prisma.oa.findUnique({ where: { id: menu.oaId }, select: { richMenuId: true } }),
        ]);
        if (dbMenu?.lineRichMenuId !== newId || dbOa?.richMenuId !== newId) {
          throw new Error(
            `DB read-back 不一致: rich_menus=${dbMenu?.lineRichMenuId ?? "null"} oas=${dbOa?.richMenuId ?? "null"} expected=${newId}`,
          );
        }
        console.log(`[apply] DB 更新完了 lineRichMenuId=${newId}`);
        // PR #160: Oa.richMenuId を更新したので id ベースの OA cache を invalidate
        await invalidateOaCacheById(menu.oaId);
      },
    });
    lineRichMenuId = result.lineRichMenuId;
    imageUploaded  = result.imageUploaded;
    applyWarnings  = result.warnings;
  } catch (err) {
    return applyFailure(err);
  }

  return ok({
    rich_menu_id:      params.id,
    line_rich_menu_id: lineRichMenuId,
    applied:           true,
    image_uploaded:    imageUploaded,
    // 旧メニュー削除失敗など、ユーザー影響のない警告（apply 自体は成功）。
    warnings:          applyWarnings ?? null,
  });
});
