// src/app/api/runtime/message/route.ts
// GET /api/runtime/message?message_id=xxx
//
// クイックリプライの target_message_id を起点に nextMessageId チェーンを辿り、
// 表示すべきメッセージ列（配列）を返す。
// テスト画面（playground）が QR タップ時に使用する。
//
// 停止条件: quick_replies を持つメッセージに到達したらそこで停止（QR 待ち状態）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { ZodError, z } from "zod";
import { formatZodErrors } from "@/lib/validations";
import type { MessageType, IconType, QuickReplyItem, RuntimePhaseMessage } from "@/types";

const querySchema = z.object({
  message_id: z.string().uuid("message_id は UUID 形式で指定してください"),
});


type MessageRow = NonNullable<Awaited<ReturnType<typeof fetchOneMessage>>>;

function rowToRuntime(msg: MessageRow): RuntimePhaseMessage {
  let quickReplies: QuickReplyItem[] | null = null;
  if (msg.quickReplies) {
    try {
      const parsed = JSON.parse(msg.quickReplies);
      if (Array.isArray(parsed)) quickReplies = parsed as QuickReplyItem[];
    } catch { /* ignore */ }
  }
  return {
    id:                msg.id,
    message_type:      msg.messageType as MessageType,
    body:              msg.body,
    asset_url:         msg.assetUrl,
    alt_text:          msg.altText         ?? null,
    flex_payload_json: msg.flexPayloadJson ?? null,
    quick_replies:     quickReplies,
    lag_ms:            msg.lagMs ?? 0,
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
  };
}

/** メッセージ 1 件をキャラクター付きで取得するヘルパー */
async function fetchOneMessage(id: string) {
  return prisma.message.findUnique({
    where:   { id },
    include: {
      character: {
        select: {
          id: true, name: true, iconType: true, iconText: true,
          iconColor: true, iconImageUrl: true,
        },
      },
    },
  });
}

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const { message_id } = querySchema.parse({
      message_id: searchParams.get("message_id") ?? undefined,
    });

    // nextMessageId チェーンを辿り、QRを持つメッセージで停止するリストを構築
    const chain: RuntimePhaseMessage[] = [];
    const visited = new Set<string>(); // 循環ガード
    let currentId: string | null = message_id;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);

      const msg = await fetchOneMessage(currentId);
      if (!msg) {
        // 最初のメッセージが存在しない場合のみ 404
        if (chain.length === 0) return notFound("メッセージ");
        break;
      }

      chain.push(rowToRuntime(msg));

      // QRを持つメッセージで停止（ユーザーの次の選択を待つ）
      if (msg.quickReplies) break;

      currentId = msg.nextMessageId;
    }

    return ok(chain);
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});
