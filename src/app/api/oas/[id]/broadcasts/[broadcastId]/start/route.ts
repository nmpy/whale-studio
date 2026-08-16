// src/app/api/oas/[id]/broadcasts/:broadcastId/start
// POST — 本配信の開始。**admin 以上**（応答メッセージを編集できる editor では実行できない）。
//
// 実送信はここでは行わない。draft → sending の確定と宛先 snapshot だけを行い、
// 実際の push は process エンドポイントが chunk 単位で進める。

import { withRole } from "@/lib/auth";
import { ok, notFound, conflict, unprocessable, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { startBroadcast } from "@/lib/broadcast/service";
import { parseBroadcastContent, toLineMessages } from "@/lib/broadcast/content";
import { validateLinePushMessages, needsOfficialValidation } from "@/lib/broadcast/validate";
import { BROADCAST_SEND_ROLE } from "../../_shared";

export const dynamic = "force-dynamic";

export const POST = withRole<{ id: string; broadcastId: string }>(
  ({ params }) => params.id,
  BROADCAST_SEND_ROLE,
  async (_req, { params }) => {
    try {
      // ── 送信前の内容ゲート ──
      // 宛先を snapshot して sending にした後で全宛先が LINE に弾かれる事故を防ぐため、
      // draft のうちに内容を検証する。ここで弾いた場合 status は draft のまま
      // （startBroadcast の CAS / snapshot ロジックには一切触れない）。
      //
      // 検証した内容と実際に sending になる内容を一致させるため、この read で取得した
      // updatedAt を revision として startBroadcast の CAS に渡す（TOCTOU 対策）。
      const current = await prisma.broadcast.findFirst({
        where:  { id: params.broadcastId, oaId: params.id },
        select: {
          status: true, contentJson: true, updatedAt: true,
          oa: { select: { channelAccessToken: true } },
        },
      });
      if (!current) return notFound("配信メッセージ");

      if (current.status === "draft") {
        const content = parseBroadcastContent(current.contentJson);
        if (!content) return unprocessable("メッセージ内容が不正です", "INVALID_CONTENT");

        // 画像 / Flex は LINE 公式の validate API にも通す（送信はされない）。
        // text は Production で送信実績のある既存経路なので、新しい外部依存を足さない。
        if (needsOfficialValidation(content.kind)) {
          // トークンが無いと検証できない。検証できないまま一斉送信しない（fail closed）。
          // テスト送信も同じ理由でトークン未設定を拒否している。
          if (!current.oa.channelAccessToken) {
            return unprocessable(
              "LINE チャネルアクセストークンが未設定です。設定してから配信してください。",
              "VALIDATION_UNAVAILABLE",
            );
          }
          const v = await validateLinePushMessages({
            messages: toLineMessages(content),
            channelAccessToken: current.oa.channelAccessToken,
          });
          if (!v.ok) {
            // invalid = 内容が悪い / unavailable = 判定できなかった。
            // どちらの場合も sending にはしない（判定できないまま一斉送信しない）。
            return unprocessable(v.message, v.reason === "invalid" ? "INVALID_CONTENT" : "VALIDATION_UNAVAILABLE");
          }
        }
      }

      const r = await startBroadcast({
        oaId: params.id,
        broadcastId: params.broadcastId,
        // 検証した draft revision に固定する。検証中に内容・対象が変われば start は成功しない。
        expectedUpdatedAt: current.status === "draft" ? current.updatedAt : undefined,
      });
      if (r.ok) return ok({ started: true, recipient_count: r.recipientCount });

      if (r.reason === "not_found")      return notFound("配信メッセージ");
      if (r.reason === "empty_audience") return unprocessable("配信対象が 0 人です", "EMPTY_AUDIENCE");
      if (r.reason === "draft_changed") {
        // status は draft のまま。宛先 snapshot も LINE 送信も発生していない。
        return conflict("確認中に配信内容が更新されました。内容と配信対象を再確認して、もう一度配信してください。");
      }
      // 二重実行はエラーにせず、現在の状態を返す（ダブルクリック / reload / retry）
      return conflict(`この配信はすでに開始されています（状態: ${r.status}）`);
    } catch (err) {
      return serverError(err);
    }
  },
);
