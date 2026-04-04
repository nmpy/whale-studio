// src/app/api/rich-menus/route.ts
// GET  /api/rich-menus?oa_id=... — OA のリッチメニュー一覧（areas 込み）
// POST /api/rich-menus           — リッチメニュー新規作成（areas 込み）

import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { createRichMenuSchema, richMenuQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";
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
  areas?: Parameters<typeof toAreaResponse>[0][];
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
    ...(m.areas !== undefined && { areas: m.areas.map(toAreaResponse) }),
  };
}

// ── GET /api/rich-menus ──────────────────────────────────
export const GET = withAuth(async (req) => {
  try {
    const q = richMenuQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const menus = await prisma.richMenu.findMany({
      where:   { oaId: q.oa_id },
      include: { areas: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(menus.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/rich-menus ─────────────────────────────────
export const POST = withAuth(async (req) => {
  try {
    const body = await req.json();
    const data = createRichMenuSchema.parse(body);

    const menu = await prisma.$transaction(async (tx) => {
      const m = await tx.richMenu.create({
        data: {
          oaId:        data.oa_id,
          name:        data.name,
          chatBarText: data.chat_bar_text,
          size:        data.size,
          imageUrl:    data.image_url ?? null,
          isActive:    data.is_active,
        },
      });
      for (const area of data.areas) {
        await tx.richMenuArea.create({
          data: {
            richMenuId:  m.id,
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
      return tx.richMenu.findUnique({
        where:   { id: m.id },
        include: { areas: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return created(toResponse(menu!));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
