// src/app/api/runtime/message/route.ts
// GET /api/runtime/message?message_id=xxx
//
// クイックリプライの target_message_id を解決してメッセージ内容を返す。
// テスト画面（playground）が QR タップ時に使用する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { ZodError, z } from "zod";
import { formatZodErrors } from "@/lib/validations";
import type { MessageType, IconType, QuickReplyItem } from "@/types";

const querySchema = z.object({
  message_id: z.string().uuid("message_id は UUID 形式で指定してください"),
});

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const { message_id } = querySchema.parse({
      message_id: searchParams.get("message_id") ?? undefined,
    });

    const msg = await prisma.message.findUnique({
      where: { id: message_id },
      include: {
        character: {
          select: {
            id: true, name: true, iconType: true, iconText: true,
            iconColor: true, iconImageUrl: true,
          },
        },
      },
    });
    if (!msg) return notFound("メッセージ");

    let quickReplies: QuickReplyItem[] | null = null;
    if (msg.quickReplies) {
      try {
        const parsed = JSON.parse(msg.quickReplies);
        if (Array.isArray(parsed)) quickReplies = parsed as QuickReplyItem[];
      } catch { /* ignore */ }
    }

    return ok({
      id:                msg.id,
      message_type:      msg.messageType as MessageType,
      body:              msg.body,
      asset_url:         msg.assetUrl,
      alt_text:          msg.altText          ?? null,
      flex_payload_json: msg.flexPayloadJson  ?? null,
      quick_replies:     quickReplies,
      sort_order:        msg.sortOrder,
      character:         msg.character
        ? {
            id:             msg.character.id,
            name:           msg.character.name,
            icon_type:      msg.character.iconType as IconType,
            icon_text:      msg.character.iconText,
            icon_color:     msg.character.iconColor,
            icon_image_url: msg.character.iconImageUrl,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});
