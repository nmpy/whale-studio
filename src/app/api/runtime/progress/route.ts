// src/app/api/runtime/progress/route.ts
// GET /api/runtime/progress?line_user_id=xxx&work_id=xxx
//
// 指定ユーザーの現在の進行状態を返す。
// まだシナリオを開始していない場合は progress: null, phase: null を返す。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { progressQuerySchema, formatZodErrors } from "@/lib/validations";
import { buildRuntimeState } from "@/lib/runtime";
import { ZodError } from "zod";

export const GET = withAuth(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = progressQuerySchema.parse({
      line_user_id: searchParams.get("line_user_id") ?? undefined,
      work_id:      searchParams.get("work_id")      ?? undefined,
    });

    const progress = await prisma.userProgress.findUnique({
      where: {
        lineUserId_workId: {
          lineUserId: query.line_user_id,
          workId:     query.work_id,
        },
      },
    });

    if (!progress) {
      return ok({ progress: null, phase: null });
    }

    const state = await buildRuntimeState(progress);
    return ok(state);
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});
