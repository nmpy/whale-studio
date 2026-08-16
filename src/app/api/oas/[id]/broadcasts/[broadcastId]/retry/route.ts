// src/app/api/oas/[id]/broadcasts/:broadcastId/retry
// POST — 再送してよい失敗だけを再送対象に戻す。**admin 以上**。
//
// LINE 公式の retry 方針に合わせ、対象は timeout / 5xx かつ retry key が有効な 24 時間以内のみ。
// 4xx（400/401/403/404/429 …）は "Don't retry" なので対象外、sent / skipped にも触れない。

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
      if (r.ok) {
        return ok({
          requeued:      r.requeued,
          // retry key 失効で再送を止めた件数（要確認）
          skipped:       r.skipped ?? 0,
          // 4xx など再送しても結果が変わらないため対象外にした件数（failed のまま保持）
          non_retryable: r.nonRetryable ?? 0,
        });
      }
      if (r.reason === "not_found") return notFound("配信メッセージ");
      return conflict("この配信は再送できる状態ではありません");
    } catch (err) {
      return serverError(err);
    }
  },
);
