// src/app/api/runtime/reset/route.ts
// POST /api/runtime/reset
//
// 指定ユーザーの進行状態を削除する（最初からやり直し）。
// テスト用途・管理操作として提供。
// 次に /api/runtime/start を呼ぶと開始フェーズから再スタートできる。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { resetScenarioSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { badRequest } from "@/lib/api-response";

export const POST = withAuth(async (req) => {
  try {
    const body = await req.json();
    const data = resetScenarioSchema.parse(body);

    await prisma.userProgress.deleteMany({
      where: { lineUserId: data.line_user_id, workId: data.work_id },
    });

    return ok({ reset: true, line_user_id: data.line_user_id, work_id: data.work_id });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
