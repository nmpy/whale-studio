// src/app/api/runtime/start/route.ts
// POST /api/runtime/start
//
// 指定ユーザーのシナリオを（再）開始する。
// - 作品の start フェーズを特定し、currentPhaseId に設定する。
// - UserProgress が既にあればリセット（上書き）する。
// - 開始フェーズのメッセージ・遷移を含む RuntimeState を返す。
//
// エラーケース:
//   - work が存在しない
//   - work に start フェーズがない（シナリオ未構成）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { startScenarioSchema, formatZodErrors } from "@/lib/validations";
import { buildRuntimeState } from "@/lib/runtime";
import { ZodError } from "zod";

export const POST = withAuth(async (req) => {
  try {
    const body = await req.json();
    const data = startScenarioSchema.parse(body);

    // 作品の存在確認
    const work = await prisma.work.findUnique({ where: { id: data.work_id } });
    if (!work) return notFound("作品");

    // 開始フェーズを取得
    const startPhase = await prisma.phase.findFirst({
      where: { workId: data.work_id, phaseType: "start", isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    if (!startPhase) {
      return badRequest(
        "この作品にはまだ開始フェーズがありません。管理画面でシナリオを構成してください。"
      );
    }

    // UserProgress を upsert（既存の進行状態をリセット）
    const progress = await prisma.userProgress.upsert({
      where: {
        lineUserId_workId: {
          lineUserId: data.line_user_id,
          workId:     data.work_id,
        },
      },
      create: {
        lineUserId:      data.line_user_id,
        workId:          data.work_id,
        currentPhaseId:  startPhase.id,
        reachedEnding:   false,
        flags:           "{}",
        lastInteractedAt: new Date(),
      },
      update: {
        currentPhaseId:  startPhase.id,
        reachedEnding:   false,
        flags:           "{}",
        lastInteractedAt: new Date(),
      },
    });

    const state = await buildRuntimeState(progress);
    return ok(state);
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
