// src/app/api/runtime/advance/route.ts
// POST /api/runtime/advance
//
// 現在フェーズから次フェーズへ進める。
//
// マッチング仕様（label 指定時）:
//   1. 遷移ラベルの完全一致（NFKC 正規化・大文字小文字無視）
//   2. 遷移 condition キーワードをユーザー入力が含む
//
// transition_id を直接指定した場合は ID マッチを優先。
//
// エラーケース:
//   - 進行状態が存在しない（開始前）
//   - すでにエンディング到達済み
//   - 現在フェーズが存在しない（データ不整合）
//   - マッチする遷移が見つからない
//   - 遷移先フェーズが存在しない（データ不整合）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { advanceScenarioSchema, formatZodErrors } from "@/lib/validations";
import { buildRuntimeState, matchTransition, applySetFlags, safeParseFlags } from "@/lib/runtime";
import { ZodError } from "zod";

export const POST = withAuth(async (req) => {
  try {
    const body = await req.json();
    const data = advanceScenarioSchema.parse(body);

    // 現在の進行状態を取得
    const progress = await prisma.userProgress.findUnique({
      where: {
        lineUserId_workId: {
          lineUserId: data.line_user_id,
          workId:     data.work_id,
        },
      },
    });
    if (!progress) {
      return badRequest(
        "シナリオがまだ開始されていません。先に /api/runtime/start を呼び出してください。"
      );
    }

    // エンディング到達済みチェック
    if (progress.reachedEnding) {
      const state = await buildRuntimeState(progress);
      return ok({ ...state, _message: "このシナリオはすでにエンディングに到達しています。" });
    }

    // ── 開始待機状態（currentPhaseId = null）: トリガーマッチングで開始 ──────
    if (!progress.currentPhaseId) {
      const startPhase = await prisma.phase.findFirst({
        where:   { workId: progress.workId, phaseType: "start", isActive: true },
        orderBy: { sortOrder: "asc" },
      });
      if (!startPhase) {
        return badRequest("この作品には開始フェーズがありません。管理画面でシナリオを構成してください。");
      }

      // startTrigger が設定されている場合のみ一致チェック（NFKC + 大文字小文字無視）
      if (startPhase.startTrigger && data.label) {
        const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
        if (norm(startPhase.startTrigger) !== norm(data.label)) {
          const state = await buildRuntimeState(progress);
          return ok({
            ...state,
            start_triggers: [{ label: startPhase.startTrigger, trigger: startPhase.startTrigger }],
            _matched: false,
            _message: `「${startPhase.startTrigger}」を送信するとシナリオが始まります`,
          });
        }
      }

      // トリガー一致（または startTrigger 未設定）→ 開始フェーズへ移行
      const updated = await prisma.userProgress.update({
        where: { id: progress.id },
        data:  { currentPhaseId: startPhase.id, lastInteractedAt: new Date() },
      });
      const state = await buildRuntimeState(updated);
      return ok({ ...state, _matched: true });
    }

    const currentPhase = await prisma.phase.findUnique({
      where: { id: progress.currentPhaseId },
      include: {
        transitionsFrom: {
          where:   { isActive: true },
          orderBy: [{ sortOrder: "asc" }],
        },
      },
    });
    if (!currentPhase) {
      return notFound("現在のフェーズ");
    }

    // エンディングフェーズからは遷移不可
    if (currentPhase.phaseType === "ending") {
      const state = await buildRuntimeState(progress);
      return ok({ ...state, _message: "エンディングフェーズからは次へ進めません。" });
    }

    const currentFlags = safeParseFlags(progress.flags);

    // ── QR target_phase_id による直接フェーズジャンプ ────────
    if (data.target_phase_id) {
      const toPhase = await prisma.phase.findUnique({ where: { id: data.target_phase_id } });
      if (!toPhase) return notFound("ジャンプ先フェーズ");

      const isEnding = toPhase.phaseType === "ending";
      const updated = await prisma.userProgress.update({
        where: { id: progress.id },
        data: {
          currentPhaseId:   toPhase.id,
          reachedEnding:    isEnding,
          lastInteractedAt: new Date(),
        },
      });
      const state = await buildRuntimeState(updated);
      return ok({ ...state, _matched: true });
    }

    // 遷移マッチング（現在の flags を考慮: flagCondition を満たす遷移のみ候補）
    const matched = matchTransition(currentPhase.transitionsFrom, {
      label:        data.label,
      transitionId: data.transition_id,
      flags:        currentFlags,
    });

    if (!matched) {
      // マッチなしのとき現状を返す（LINE webhook では「わかりません」等を返すイメージ）
      const state = await buildRuntimeState(progress);
      const availableLabels = currentPhase.transitionsFrom
        .filter((t) => t.isActive)
        .map((t) => `「${t.label}」`);
      return ok({
        ...state,
        _message:
          availableLabels.length > 0
            ? `選択肢に一致しませんでした。次のいずれかを選んでください: ${availableLabels.join(" / ")}`
            : "このフェーズには有効な遷移がありません。",
        _matched: false,
      });
    }

    // 遷移先フェーズを確認
    const toPhase = await prisma.phase.findUnique({ where: { id: matched.toPhaseId } });
    if (!toPhase) return notFound("遷移先フェーズ");

    const isEnding  = toPhase.phaseType === "ending";
    // setFlags を現在の flags にマージ
    const newFlags  = applySetFlags(currentFlags, matched.setFlags);

    // UserProgress を更新（フェーズ進行 + フラグ更新）
    const updated = await prisma.userProgress.update({
      where: { id: progress.id },
      data: {
        currentPhaseId:   toPhase.id,
        reachedEnding:    isEnding,
        flags:            JSON.stringify(newFlags),
        lastInteractedAt: new Date(),
      },
    });

    const state = await buildRuntimeState(updated);
    return ok({
      ...state,
      _matched:    true,
      _transition: { id: matched.id, label: matched.label },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
