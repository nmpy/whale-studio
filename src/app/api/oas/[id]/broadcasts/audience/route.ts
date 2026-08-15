// src/app/api/oas/[id]/broadcasts/audience/route.ts
// POST /api/oas/:id/broadcasts/audience — 配信予定人数の確認。editor 以上。
//
// 宛先そのもの（lineUserId 配列）は返さない。UI が必要とするのは人数だけであり、
// クライアントへ宛先を渡さないことで「クライアント指定の宛先に送る」経路を作らない。

import { withRole } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { ZodError } from "zod";
import { formatZodErrors } from "@/lib/validations";
import { countBroadcastAudience } from "@/lib/broadcast/audience";
import { BROADCAST_EDIT_ROLE, broadcastTargetSchema, toTarget } from "../_shared";

export const dynamic = "force-dynamic";

export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  BROADCAST_EDIT_ROLE,
  async (req, { params }) => {
    try {
      const body = broadcastTargetSchema.parse(await req.json());
      const count = await countBroadcastAudience(params.id, toTarget(body));
      return ok({ count });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力内容が不正です", formatZodErrors(err));
      return serverError(err);
    }
  },
);
