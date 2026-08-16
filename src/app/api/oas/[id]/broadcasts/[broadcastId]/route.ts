// src/app/api/oas/[id]/broadcasts/[broadcastId]/route.ts
// GET   /api/oas/:id/broadcasts/:broadcastId — 配信詳細 + 進捗。viewer 以上。
// PATCH /api/oas/:id/broadcasts/:broadcastId — 下書きの編集。editor 以上・draft のときのみ。

import { withRole } from "@/lib/auth";
import { ok, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { ZodError } from "zod";
import { formatZodErrors } from "@/lib/validations";
import type { Prisma } from "@prisma/client";
import {
  BROADCAST_VIEW_ROLE, BROADCAST_EDIT_ROLE,
  updateBroadcastSchema, toBroadcastResponse,
} from "../_shared";
import { RETRY_KEY_TTL_MS, retryableFailureWhere } from "@/lib/broadcast/processor";

export const dynamic = "force-dynamic";
type P = { id: string; broadcastId: string };

export const GET = withRole<P>(
  ({ params }) => params.id,
  BROADCAST_VIEW_ROLE,
  async (_req, { params }) => {
    try {
      // OA スコープ込みで取得。他 OA の broadcastId を渡されても存在を露出しない。
      const row = await prisma.broadcast.findFirst({
        where: { id: params.broadcastId, oaId: params.id },
      });
      if (!row) return notFound("配信メッセージ");

      // 再送してよい失敗の件数（LINE 公式 retry 方針: timeout / 5xx のみ、かつ 24h 以内）。
      const retryableFailureCount = await prisma.broadcastRecipient.count({
        where: {
          broadcastId: row.id,
          status:      "failed",
          createdAt:   { gte: new Date(Date.now() - RETRY_KEY_TTL_MS) },
          ...retryableFailureWhere(),
        },
      });

      // 失敗した宛先の内訳（調査・再送用）。lineUserId は先頭 8 文字だけ返す。
      const failed = await prisma.broadcastRecipient.findMany({
        where:  { broadcastId: row.id, status: "failed" },
        select: { lineUserId: true, httpStatus: true, errorMessage: true },
        take:   50,
      });

      return ok({
        ...toBroadcastResponse(row),
        pending_count: await prisma.broadcastRecipient.count({
          where: { broadcastId: row.id, status: "pending" },
        }),
        // LINE が受理したか確定できず自動再送を止めた宛先（要確認）
        skipped_count: await prisma.broadcastRecipient.count({
          where: { broadcastId: row.id, status: "skipped" },
        }),
        // 再送してよい失敗（timeout / 5xx かつ retry key が有効な 24 時間以内）。
        // UI の「再送」ボタンはこの件数だけを根拠にする（failure_count では判断しない）。
        retryable_failure_count: retryableFailureCount,
        // 4xx など再送しても結果が変わらない失敗 + retry key 失効分。
        non_retryable_failure_count: Math.max(0, row.failureCount - retryableFailureCount),
        failed_samples: failed.map((f) => ({
          line_user_id_prefix: f.lineUserId.slice(0, 8),
          http_status:         f.httpStatus,
          error_message:       f.errorMessage,
        })),
      });
    } catch (err) {
      return serverError(err);
    }
  },
);

export const PATCH = withRole<P>(
  ({ params }) => params.id,
  BROADCAST_EDIT_ROLE,
  async (req, { params }) => {
    try {
      const body = updateBroadcastSchema.parse(await req.json());

      const current = await prisma.broadcast.findFirst({
        where:  { id: params.broadcastId, oaId: params.id },
        select: { id: true, status: true },
      });
      if (!current) return notFound("配信メッセージ");
      // 送信開始後の内容変更は認めない（送った内容と保存内容が食い違うのを防ぐ）
      if (current.status !== "draft") {
        return conflict("配信を開始した後は内容を変更できません");
      }

      const hasTarget = "target_type" in body;

      // **write 自体を draft 限定の compare-and-swap にする。**
      // 上の findFirst で draft だったことは保証にならない（read と write の間に
      // start が draft → sending を確定させうる）。ここで status を where に含めることで、
      // 「sending になった後に内容が書き換わる」経路を消す。
      const updated = await prisma.broadcast.updateMany({
        where: { id: current.id, oaId: params.id, status: "draft" },
        data: {
          ...(body.name    !== undefined && { name: body.name }),
          ...(body.content !== undefined && { contentJson: body.content as unknown as Prisma.InputJsonValue }),
          ...(hasTarget && {
            targetType:    body.target_type,
            segmentId:     body.target_type === "segment" ? body.segment_id : null,
            segmentWorkId: body.target_type === "segment" ? body.work_id     : null,
          }),
        },
      });
      if (updated.count !== 1) {
        // CAS に負けた = この間に配信が開始された
        return conflict("配信を開始した後は内容を変更できません");
      }

      const row = await prisma.broadcast.findFirst({ where: { id: current.id, oaId: params.id } });
      if (!row) return notFound("配信メッセージ");
      return ok(toBroadcastResponse(row));
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力内容が不正です", formatZodErrors(err));
      return serverError(err);
    }
  },
);
