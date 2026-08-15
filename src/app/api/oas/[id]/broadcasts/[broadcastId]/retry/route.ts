// src/app/api/oas/[id]/broadcasts/:broadcastId/retry
// POST — 失敗した宛先だけを再送対象に戻す。**admin 以上**。
//
// 成功済み（sent）の宛先には触れないため、再送で二重に届くことはない。

import { withRole } from "@/lib/auth";
import { ok, notFound, conflict, serverError } from "@/lib/api-response";
import { retryFailedRecipients } from "@/lib/broadcast/service";
import { BROADCAST_SEND_ROLE } from "../../_shared";

export const dynamic = "force-dynamic";

export const POST = withRole<{ id: string; broadcastId: string }>(
  ({ params }) => params.id,
  BROADCAST_SEND_ROLE,
  async (_req, { params }) => {
    try {
      const r = await retryFailedRecipients({ oaId: params.id, broadcastId: params.broadcastId });
      if (r.ok) return ok({ requeued: r.requeued });
      if (r.reason === "not_found") return notFound("配信メッセージ");
      return conflict("この配信は再送できる状態ではありません");
    } catch (err) {
      return serverError(err);
    }
  },
);
