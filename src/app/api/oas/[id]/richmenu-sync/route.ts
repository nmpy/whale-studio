// src/app/api/oas/[id]/richmenu-sync/route.ts
// POST /api/oas/:oaId/richmenu-sync
//
// Google Spreadsheet の RichMenus / RichMenuItems シートを読み込み、
// RichMenu + RichMenuArea をDBに保存してから LINE に適用する。
//
// カスタムエディターと同一データ構造（RichMenu + RichMenuArea テーブル）と
// 同一適用処理（applyRichMenuConfig）を使用する。
//
// リクエストボディ:
//   {
//     spreadsheet_id: string;
//     work_id?:       string;
//     size?:          "compact" | "full";
//     dry_run?:       boolean;  // true = LINE API を呼ばずに内容確認のみ
//   }

import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import {
  loadRichMenusFromSheets,
  loadRichMenuItemsFromSheets,
  buildRichMenuConfig,
} from "@/lib/richmenu-from-sheets";
import {
  applyRichMenuConfig,
} from "@/lib/line-richmenu";
import type { RichMenuConfig } from "@/lib/line-richmenu";

export const POST = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const oaId = params.id;
    const body = (await req.json()) as {
      spreadsheet_id: string;
      work_id?:       string;
      size?:          "compact" | "full";
      dry_run?:       boolean;
    };

    if (!body.spreadsheet_id?.trim()) {
      return badRequest("spreadsheet_id は必須です");
    }

    const oa = await prisma.oa.findUnique({ where: { id: oaId } });
    if (!oa) return notFound("OA");

    const dryRun        = body.dry_run ?? false;
    const size          = body.size ?? "compact";
    const spreadsheetId = body.spreadsheet_id.trim();

    // ── 1. スプレッドシートからメニュー一覧を取得 ──
    let sheetMenus;
    try {
      sheetMenus = await loadRichMenusFromSheets(spreadsheetId, body.work_id);
    } catch (e) {
      return badRequest(
        `スプレッドシートの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (sheetMenus.length === 0) {
      return ok({
        dry_run: dryRun,
        total:   0,
        applied: [],
        skipped: [],
        message: "対象メニューが見つかりませんでした（work_id の絞り込みを確認してください）",
      });
    }

    type AppliedItem = {
      richmenu_id:       string;
      db_id:             string;
      line_rich_menu_id: string;
      is_default:        boolean;
      visible_phase:     string | null;
      image_uploaded:    boolean;
    };
    type SkippedItem = { richmenu_id: string; reason: string };

    const applied: AppliedItem[] = [];
    const skipped: SkippedItem[] = [];

    for (const menu of sheetMenus) {
      try {
        // ── 2. アイテム取得 ──
        const items       = await loadRichMenuItemsFromSheets(spreadsheetId, menu.richmenu_id);
        const activeItems = items.filter((it) => it.is_active);

        if (activeItems.length === 0) {
          skipped.push({ richmenu_id: menu.richmenu_id, reason: "アクティブなアイテムがありません" });
          continue;
        }

        // ── 3. LINE RichMenuConfig 構築 ──
        const config: RichMenuConfig = buildRichMenuConfig(menu, items, size);

        if (dryRun) {
          applied.push({
            richmenu_id:       menu.richmenu_id,
            db_id:             "(dry_run)",
            line_rich_menu_id: "(dry_run)",
            is_default:        menu.is_default,
            visible_phase:     menu.visible_phase,
            image_uploaded:    false,
          });
          continue;
        }

        // ── 4. 既存 DB レコードを確認（再同期時は旧 LINE メニューを削除） ──
        const existingDbMenu = await prisma.richMenu.findFirst({
          where: {
            oaId:                  oaId,
            spreadsheetRichMenuId: menu.richmenu_id,
          },
        });

        // ── 5. LINE API 適用（共通関数） ──
        const { lineRichMenuId, imageUploaded } = await applyRichMenuConfig({
          token:              oa.channelAccessToken,
          config,
          imageUrl:           menu.image_url,
          oldLineRichMenuId:  existingDbMenu?.lineRichMenuId ?? null,
          setDefault:         menu.is_default,
          logPrefix:          `[sync:${menu.richmenu_id}]`,
        });

        // ── 6. DB に RichMenu + RichMenuArea を upsert ──
        // LINE config の areas を DB フィールドに変換（座標は buildRichMenuConfig が計算済み）
        const dbAreas = config.areas.map((area, i) => ({
          x:           area.bounds.x,
          y:           area.bounds.y,
          width:       area.bounds.width,
          height:      area.bounds.height,
          actionType:  area.action.type,
          actionLabel: area.action.label,
          actionText:  area.action.type === "message"  ? area.action.text
                     : area.action.type === "postback" ? (area.action.displayText ?? null)
                     : null,
          actionData:  area.action.type === "postback" ? area.action.data  : null,
          actionUri:   area.action.type === "uri"      ? area.action.uri   : null,
          sortOrder:   i,
        }));

        let dbMenuId: string;
        await prisma.$transaction(async (tx) => {
          // RichMenu レコードを upsert
          if (existingDbMenu) {
            await tx.richMenu.update({
              where: { id: existingDbMenu.id },
              data: {
                lineRichMenuId,
                name:                  menu.name,
                chatBarText:           menu.chat_bar_text,
                size,
                imageUrl:              menu.image_url ?? null,
                visiblePhase:          menu.visible_phase,
                spreadsheetRichMenuId: menu.richmenu_id,
                isActive:              true,
              },
            });
            dbMenuId = existingDbMenu.id;
          } else {
            const created = await tx.richMenu.create({
              data: {
                oaId,
                name:                  menu.name,
                chatBarText:           menu.chat_bar_text,
                size,
                imageUrl:              menu.image_url ?? null,
                lineRichMenuId,
                visiblePhase:          menu.visible_phase,
                spreadsheetRichMenuId: menu.richmenu_id,
                isActive:              true,
              },
            });
            dbMenuId = created.id;
          }

          // RichMenuArea を全置換
          await tx.richMenuArea.deleteMany({ where: { richMenuId: dbMenuId } });
          for (const area of dbAreas) {
            await tx.richMenuArea.create({
              data: { richMenuId: dbMenuId, ...area },
            });
          }

          // is_default の場合、Oa.richMenuId も更新
          if (menu.is_default) {
            await tx.oa.update({
              where: { id: oaId },
              data:  { richMenuId: lineRichMenuId },
            });
          }
        });

        applied.push({
          richmenu_id:       menu.richmenu_id,
          db_id:             dbMenuId!,
          line_rich_menu_id: lineRichMenuId,
          is_default:        menu.is_default,
          visible_phase:     menu.visible_phase,
          image_uploaded:    imageUploaded,
        });
      } catch (menuErr) {
        console.error(`[richmenu-sync] メニュー ${menu.richmenu_id} エラー:`, menuErr);
        skipped.push({
          richmenu_id: menu.richmenu_id,
          reason:      menuErr instanceof Error ? menuErr.message : String(menuErr),
        });
      }
    }

    return ok({
      dry_run:       dryRun,
      total:         sheetMenus.length,
      applied_count: applied.length,
      skipped_count: skipped.length,
      applied,
      skipped,
    });
  } catch (err) {
    return serverError(err);
  }
});
