// src/app/api/hint-logs/route.ts
// POST /api/hint-logs — ヒントイベントログ記録（LINE Bot から呼び出す）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createHintLogSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const data = createHintLogSchema.parse(body);

    const log = await prisma.hintLog.create({
      data: {
        oaId:        data.oa_id,
        workId:      data.work_id,
        phaseId:     data.phase_id ?? null,
        riddleId:    data.riddle_id,
        lineUserId:  data.line_user_id,
        hintStep:    data.hint_step,
        eventType:   data.event_type,
        actionType:  data.action_type  ?? null,
        actionValue: data.action_value ?? null,
      },
    });

    return created({ id: log.id, created_at: log.createdAt });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
