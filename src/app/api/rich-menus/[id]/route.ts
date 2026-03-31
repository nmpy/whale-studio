// src/app/api/rich-menus/[id]/route.ts
// GET    /api/rich-menus/:id — 詳細（areas 込み）
// PATCH  /api/rich-menus/:id — 更新（areas を指定した場合は全置換）
// DELETE /api/rich-menus/:id — 削除

import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { updateRichMenuSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toAreaResponse(a: {
  id: string; richMenuId: string; x: number; y: number;
  width: number; height: number; actionType: string; actionLabel: string;
  actionText: string | null; actionData: string | null; actionUri: string | null;
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
    action_uri:   a.actionUri,
    sort_order:   a.sortOrder,
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
    const data = updateRichMenuSchema.parse(body);

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
              actionUri:   area.action_uri ?? null,
              sortOrder:   area.sort_order ?? 0,
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
export const DELETE = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const existing = await prisma.richMenu.findUnique({ where: { id: params.id } });
    if (!existing) return notFound("リッチメニュー");
    await prisma.richMenu.delete({ where: { id: params.id } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
