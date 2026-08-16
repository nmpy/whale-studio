// src/app/api/oas/[id]/broadcasts/:broadcastId/process
// POST — 送信を chunk 単位で進める。**admin 以上**。
//
// 1 リクエストで全宛先を送らない。hasMore=true の間だけ呼び出し側が再度叩く。
// sending 以外の状態では何もしないため、多重に叩かれても二重送信にならない。

import { withRole } from "@/lib/auth";
import { ok, notFound, conflict, unprocessable, serverError } from "@/lib/api-response";
import { processBroadcastChunk } from "@/lib/broadcast/processor";
import { BROADCAST_SEND_ROLE } from "../../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withRole<{ id: string; broadcastId: string }>(
  ({ params }) => params.id,
  BROADCAST_SEND_ROLE,
  async (_req, { params }) => {
    try {
      const r = await processBroadcastChunk({ oaId: params.id, broadcastId: params.broadcastId });
      if (r.ok) {
        return ok({
          processed: r.processed, sent: r.sent, failed: r.failed,
          has_more: r.hasMore, status: r.status,
        });
      }
      if (r.reason === "not_found")   return notFound("配信メッセージ");
      if (r.reason === "not_sending") return conflict("この配信は送信中ではありません");
      return unprocessable(
        r.reason === "no_token" ? "LINE チャネルアクセストークンが未設定です" : "メッセージ内容が不正です",
        r.reason.toUpperCase(),
      );
    } catch (err) {
      return serverError(err);
    }
  },
);
