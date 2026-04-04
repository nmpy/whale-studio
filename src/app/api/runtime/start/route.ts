// src/app/api/runtime/start/route.ts
// POST /api/runtime/start
//
// 指定ユーザーの進行状態をリセットし、開始待機状態にする。
//
// 実機LINE の挙動に準拠:
//   - ユーザーが最初のメッセージを送るまで物語は始まらない
//   - このエンドポイントは progress を初期化するだけ（currentPhaseId = null）
//   - 実際の開始は /api/runtime/advance でトリガーテキストを送信して行う
//
// レスポンス:
//   - progress: 初期化済み進行状態（currentPhaseId = null）
//   - phase: null
//   - start_triggers: 開始トリガーボタン情報（テスト画面の QR として表示）
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
import type { StartTrigger } from "@/types";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = startScenarioSchema.parse(body);

    // 作品の存在確認
    const work = await prisma.work.findUnique({ where: { id: data.work_id } });
    if (!work) return notFound("作品");

    // 開始フェーズを取得（startTrigger を start_triggers として返す）
    const startPhase = await prisma.phase.findFirst({
      where:   { workId: data.work_id, phaseType: "start", isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    if (!startPhase) {
      return badRequest(
        "この作品にはまだ開始フェーズがありません。管理画面でシナリオを構成してください。"
      );
    }

    const isPreview = data.is_preview ?? false;
    const previewBy = isPreview ? user.id : null;

    // UserProgress を upsert（currentPhaseId = null の待機状態でリセット）
    // is_preview=true の場合は isPreview/previewBy を保存し、本番プレイデータと分離する
    const progress = await prisma.userProgress.upsert({
      where: {
        lineUserId_workId: {
          lineUserId: data.line_user_id,
          workId:     data.work_id,
        },
      },
      create: {
        lineUserId:       data.line_user_id,
        workId:           data.work_id,
        currentPhaseId:   null,       // 待機状態: フェーズ未設定
        reachedEnding:    false,
        flags:            "{}",
        lastInteractedAt: new Date(),
        isPreview,
        previewBy,
      },
      update: {
        currentPhaseId:   null,       // 待機状態にリセット
        reachedEnding:    false,
        flags:            "{}",
        lastInteractedAt: new Date(),
        isPreview,
        previewBy,
      },
    });

    // start_triggers: startTrigger が設定されていればそれを、なければ「はじめる」をデフォルトとして返す
    const triggerText = startPhase.startTrigger?.trim() || "はじめる";
    const startTriggers: StartTrigger[] = [{ label: triggerText, trigger: triggerText }];

    const state = await buildRuntimeState(progress);
    return ok({ ...state, start_triggers: startTriggers });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
