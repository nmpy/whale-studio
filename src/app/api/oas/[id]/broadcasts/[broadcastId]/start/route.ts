// src/app/api/oas/[id]/broadcasts/:broadcastId/start
// POST — 本配信の開始。**admin 以上**（応答メッセージを編集できる editor では実行できない）。
//
// 実送信はここでは行わない。draft → sending の確定と宛先 snapshot だけを行い、
// 実際の push は process エンドポイントが chunk 単位で進める。

import { withRole } from "@/lib/auth";
import { ok, notFound, conflict, unprocessable, serverError } from "@/lib/api-response";
import { startBroadcast } from "@/lib/broadcast/service";
import { BROADCAST_SEND_ROLE } from "../../_shared";

export const dynamic = "force-dynamic";

export const POST = withRole<{ id: string; broadcastId: string }>(
  ({ params }) => params.id,
  BROADCAST_SEND_ROLE,
  async (_req, { params }) => {
    try {
      const r = await startBroadcast({ oaId: params.id, broadcastId: params.broadcastId });
      if (r.ok) return ok({ started: true, recipient_count: r.recipientCount });

      if (r.reason === "not_found")      return notFound("配信メッセージ");
      if (r.reason === "empty_audience") return unprocessable("配信対象が 0 人です", "EMPTY_AUDIENCE");
      // 二重実行はエラーにせず、現在の状態を返す（ダブルクリック / reload / retry）
      return conflict(`この配信はすでに開始されています（状態: ${r.status}）`);
    } catch (err) {
      return serverError(err);
    }
  },
);
