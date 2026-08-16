// src/app/api/oas/[id]/broadcasts/test-send/route.ts
// POST /api/oas/:id/broadcasts/test-send — テスト送信。editor 以上。
//
// 本配信とは完全に別経路。Broadcast / BroadcastRecipient を一切作らないため、
// recipient snapshot・recipientCount・successCount・failureCount のいずれにも影響しない
// （＝配信実績には残らない）。送信先は「操作者自身が指定した 1 件の lineUserId」のみ。

import { withRole } from "@/lib/auth";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { z, ZodError } from "zod";
import { formatZodErrors } from "@/lib/validations";
import { pushToLine } from "@/lib/line";
import { parseBroadcastContent, toLineMessages } from "@/lib/broadcast/content";
import { validateLinePushMessages, needsOfficialValidation } from "@/lib/broadcast/validate";
import { isSendableLineUserId } from "@/lib/broadcast/audience";
import { BROADCAST_EDIT_ROLE, broadcastContentSchema } from "../_shared";

export const dynamic = "force-dynamic";

const schema = z.object({
  line_user_id: z.string().min(1),
  content:      broadcastContentSchema,
});

export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  BROADCAST_EDIT_ROLE,
  async (req, { params }) => {
    try {
      const body = schema.parse(await req.json());
      if (!isSendableLineUserId(body.line_user_id)) {
        return badRequest("LINE ユーザー ID の形式が正しくありません");
      }
      const content = parseBroadcastContent(body.content);
      if (!content) return badRequest("メッセージ内容が不正です");

      const oa = await prisma.oa.findUnique({
        where: { id: params.id },
        select: { channelAccessToken: true },
      });
      if (!oa) return notFound("OA");
      if (!oa.channelAccessToken) return badRequest("LINE チャネルアクセストークンが未設定です");

      const messages = toLineMessages(content);

      // 本配信 start と同じゲートをテスト送信でも通す。
      // 「テストは通ったのに本配信で弾かれる」「テストで理由の分からない失敗をする」を防ぐ。
      if (needsOfficialValidation(content.kind)) {
        const v = await validateLinePushMessages({ messages, channelAccessToken: oa.channelAccessToken });
        if (!v.ok) return badRequest(v.message);
      }

      const res = await pushToLine(body.line_user_id, messages, oa.channelAccessToken);
      console.log("[line:broadcast:test-send]", JSON.stringify({
        oaId: params.id, userId: body.line_user_id.slice(0, 8), kind: content.kind,
        ok: res.ok, status: res.status ?? null,
      }));

      // 配信実績には残さない（Broadcast も BroadcastRecipient も作らない）
      return ok({ sent: res.ok, http_status: res.status ?? null });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力内容が不正です", formatZodErrors(err));
      return serverError(err);
    }
  },
);
