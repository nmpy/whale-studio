// src/app/api/rich-menus/[id]/route.ts
// GET    /api/rich-menus/:id — 詳細（areas 込み）
// PATCH  /api/rich-menus/:id — 更新（areas を指定した場合は全置換）
// DELETE /api/rich-menus/:id — 削除

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { invalidateOaCacheById } from "@/lib/oa-cache";
import { deleteRichMenuFromLine } from "@/lib/line-richmenu";
import { updateRichMenuSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toAreaResponse(a: {
  id: string; richMenuId: string; x: number; y: number;
  width: number; height: number; actionType: string; actionLabel: string;
  actionText: string | null; actionData: string | null; actionUri: string | null;
  destinationId: string | null;
  sortOrder: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    id:           a.id,
    rich_menu_id: a.richMenuId,
    x:            a.x,
    y:            a.y,
    width:        a.width,
    height:       a.height,
    action_type:  a.actionType,
    action_label: a.actionLabel,
    action_text:  a.actionText,
    action_data:  a.actionData,
    action_uri:      a.actionUri,
    destination_id:  a.destinationId ?? null,
    sort_order:      a.sortOrder,
    created_at:   a.createdAt,
    updated_at:   a.updatedAt,
  };
}

function toResponse(m: {
  id: string; oaId: string; name: string; chatBarText: string; size: string;
  imageUrl: string | null; lineRichMenuId: string | null; isActive: boolean;
  createdAt: Date; updatedAt: Date;
  areas: Parameters<typeof toAreaResponse>[0][];
}) {
  return {
    id:                m.id,
    oa_id:             m.oaId,
    name:              m.name,
    chat_bar_text:     m.chatBarText,
    size:              m.size,
    image_url:         m.imageUrl,
    line_rich_menu_id: m.lineRichMenuId,
    is_active:         m.isActive,
    created_at:        m.createdAt,
    updated_at:        m.updatedAt,
    areas:             m.areas.map(toAreaResponse),
  };
}

// ── GET /api/rich-menus/:id ──────────────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const menu = await prisma.richMenu.findUnique({
      where:   { id: params.id },
      include: { areas: { orderBy: { sortOrder: "asc" } } },
    });
    if (!menu) return notFound("リッチメニュー");
    return ok(toResponse(menu));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/rich-menus/:id ────────────────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }) => {
  try {
    const existing = await prisma.richMenu.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("リッチメニュー");

    const body = await req.json();

    // ── デバッグ: 受信ボディのエリア一覧を出力 ──
    console.log(`[rich-menus PATCH] 受信ボディ raw areas件数=${Array.isArray(body?.areas) ? body.areas.length : "なし(areas未指定)"}`);
    if (Array.isArray(body?.areas)) {
      for (const [i, a] of (body.areas as Record<string, unknown>[]).entries()) {
        console.log(
          `[rich-menus PATCH][raw]   [${i}]`,
          `action_type="${a.action_type}"`,
          `action_label="${a.action_label}"`,
          `action_text=${a.action_text !== null && a.action_text !== undefined ? `"${a.action_text}"` : String(a.action_text)}`,
          `action_uri=${a.action_uri  !== null && a.action_uri  !== undefined ? `"${a.action_uri}"` : String(a.action_uri)}`,
          `action_data=${a.action_data !== null && a.action_data !== undefined ? `"${a.action_data}"` : String(a.action_data)}`
        );
      }
    }

    let data: ReturnType<typeof updateRichMenuSchema.parse>;
    try {
      data = updateRichMenuSchema.parse(body);
    } catch (zodErr) {
      console.error("[rich-menus PATCH] Zod バリデーションエラー:", JSON.stringify(zodErr));
      throw zodErr;
    }

    // ── デバッグ: Zod parse 後のエリア一覧を出力 ──
    if (data.areas !== undefined) {
      console.log(`[rich-menus PATCH] Zod parse後 areas件数=${data.areas.length}`);
      for (const [i, a] of data.areas.entries()) {
        console.log(
          `[rich-menus PATCH][parsed] [${i}]`,
          `action_type="${a.action_type}"`,
          `action_label="${a.action_label}"`,
          `action_text=${a.action_text !== null && a.action_text !== undefined ? `"${a.action_text}"` : String(a.action_text)}`,
          `action_uri=${a.action_uri  !== null && a.action_uri  !== undefined ? `"${a.action_uri}"` : String(a.action_uri)}`
        );
      }
    }

    const menu = await prisma.$transaction(async (tx) => {
      await tx.richMenu.update({
        where: { id: params.id },
        data: {
          ...(data.name          !== undefined && { name:        data.name }),
          ...(data.chat_bar_text !== undefined && { chatBarText: data.chat_bar_text }),
          ...(data.size          !== undefined && { size:        data.size }),
          ...(data.image_url     !== undefined && { imageUrl:    data.image_url }),
          ...(data.is_active     !== undefined && { isActive:    data.is_active }),
        },
      });

      if (data.areas !== undefined) {
        // エリアを全置換
        await tx.richMenuArea.deleteMany({ where: { richMenuId: params.id } });
        for (const area of data.areas) {
          await tx.richMenuArea.create({
            data: {
              richMenuId:  params.id,
              x:           area.x,
              y:           area.y,
              width:       area.width,
              height:      area.height,
              actionType:  area.action_type,
              actionLabel: area.action_label,
              actionText:  area.action_text ?? null,
              actionData:  area.action_data ?? null,
              actionUri:       area.action_uri ?? null,
              destinationId:   area.destination_id ?? null,
              sortOrder:       area.sort_order ?? 0,
            },
          });
        }
      }

      return tx.richMenu.findUnique({
        where:   { id: params.id },
        include: { areas: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return ok(toResponse(menu!));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/rich-menus/:id ───────────────────────────
//
// LINE 側 → DB の順で削除する。
//
// 旧実装は DB レコードだけを削除していたため、LINE 側にはリッチメニュー本体も
// デフォルト設定も残り、「CMS で削除したのに LINE アプリには古いリッチメニューが
// 表示され続ける」状態になっていた（D.O.T / 2026-08 で実際に発生。CMS 上は削除済みに
// 見えるので、運用者からは原因が分からない）。
//
// LINE 側の削除に失敗した場合は DB を変更せずに 502 を返し、
// 「DB だけ成功して不整合」を構造的に起こさない（= apply 側 #622 と同じ方針）。
export const DELETE = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const existing = await prisma.richMenu.findUnique({
      where:   { id: params.id },
      include: { oa: { select: { channelAccessToken: true, richMenuId: true } } },
    });
    if (!existing) return notFound("リッチメニュー");

    // ── 1. LINE 側の後始末（デフォルト解除 → メニュー削除）──
    if (existing.lineRichMenuId) {
      try {
        await deleteRichMenuFromLine({
          token:          existing.oa.channelAccessToken,
          lineRichMenuId: existing.lineRichMenuId,
          logPrefix:      `[rich-menus DELETE ${params.id}]`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[rich-menus DELETE] LINE 側の削除に失敗:", err);
        return NextResponse.json(
          {
            success: false,
            error: {
              code:    "LINE_DELETE_ERROR",
              message: `LINE 側のリッチメニュー削除に失敗したため、削除を中止しました: ${message}`,
            },
          },
          { status: 502 }
        );
      }
    }

    // ── 2. DB 削除 + Oa.richMenuId の dangling 解消 ──
    //     Oa.richMenuId が削除対象を指したままだと、DB 内に存在しない LINE ID への
    //     参照が残る（D.O.T で実際に残っていた）。
    const clearOaPointer =
      existing.lineRichMenuId !== null &&
      existing.oa.richMenuId === existing.lineRichMenuId;

    await prisma.$transaction([
      prisma.richMenu.delete({ where: { id: params.id } }),
      ...(clearOaPointer
        ? [prisma.oa.update({ where: { id: existing.oaId }, data: { richMenuId: null } })]
        : []),
    ]);
    if (clearOaPointer) await invalidateOaCacheById(existing.oaId);

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
