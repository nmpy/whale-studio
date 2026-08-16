// src/app/api/oas/[id]/broadcasts/route.ts
// GET  /api/oas/:id/broadcasts — 配信メッセージ一覧（履歴）。viewer 以上。
// POST /api/oas/:id/broadcasts — 配信メッセージの下書き作成。editor 以上。
//
// 「配信メッセージ」専用 API。既存「応答メッセージ」の /api/messages 系とは別系統で、
// 相互に呼び出さない。

import { withRole } from "@/lib/auth";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { ZodError } from "zod";
import { formatZodErrors } from "@/lib/validations";
import type { Prisma } from "@prisma/client";
import {
  BROADCAST_VIEW_ROLE, BROADCAST_EDIT_ROLE,
  createBroadcastSchema, toBroadcastResponse,
} from "./_shared";

export const dynamic = "force-dynamic";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  BROADCAST_VIEW_ROLE,
  async (_req, { params }) => {
    try {
      const rows = await prisma.broadcast.findMany({
        where:   { oaId: params.id },   // OA スコープ。他 OA の配信は返さない
        orderBy: { createdAt: "desc" },
        take:    100,
      });
      return ok(rows.map(toBroadcastResponse));
    } catch (err) {
      return serverError(err);
    }
  },
);

export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  BROADCAST_EDIT_ROLE,
  async (req, { params }, user) => {
    try {
      const body = createBroadcastSchema.parse(await req.json());

      const row = await prisma.broadcast.create({
        data: {
          oaId:            params.id,
          name:            body.name,
          status:          "draft",     // 作成時点では絶対に送らない
          targetType:      body.target_type,
          segmentId:       body.target_type === "segment" ? body.segment_id : null,
          segmentWorkId:   body.target_type === "segment" ? body.work_id     : null,
          contentJson:     body.content as unknown as Prisma.InputJsonValue,
          createdByUserId: user.id,
        },
      });
      return created(toBroadcastResponse(row));
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力内容が不正です", formatZodErrors(err));
      return serverError(err);
    }
  },
);
