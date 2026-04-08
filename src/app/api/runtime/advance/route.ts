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

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = advanceScenarioSchema.parse(body);

    const isPreview = data.is_preview ?? false;
    const previewBy = isPreview ? user.id : null;

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
        data:  { currentPhaseId: startPhase.id, lastInteractedAt: new Date(), isPreview, previewBy },
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
          isPreview,
          previewBy,
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

      // kind="response" メッセージでキーワード一致するものを返す
      let responseMessages: import("@/types").RuntimePhaseMessage[] = [];
      if (data.label) {
        const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
        const normLabel = norm(data.label);
        const responseRows = await prisma.message.findMany({
          where: { phaseId: progress.currentPhaseId!, kind: "response" },
          include: {
            character: {
              select: { id: true, name: true, iconType: true, iconText: true, iconColor: true, iconImageUrl: true },
            },
          },
          orderBy: { sortOrder: "asc" },
        });

        // メッセージを RuntimePhaseMessage に変換するヘルパー（quickReplies を含む）
        type ResponseRow = typeof responseRows[number];
        function rowToRuntimeMsg(m: ResponseRow): import("@/types").RuntimePhaseMessage {
          let quickReplies: import("@/types").QuickReplyItem[] | null = null;
          if (m.quickReplies) {
            try {
              const parsed = JSON.parse(m.quickReplies);
              if (Array.isArray(parsed)) quickReplies = parsed as import("@/types").QuickReplyItem[];
            } catch { /* ignore */ }
          }
          return {
            id:                m.id,
            message_type:      m.messageType as import("@/types").MessageType,
            body:              m.body,
            asset_url:         m.assetUrl,
            alt_text:          m.altText         ?? null,
            flex_payload_json: m.flexPayloadJson ?? null,
            quick_replies:     quickReplies,
            lag_ms:            m.lagMs ?? 0,
            hint_mode:         ((m as { hintMode?: string }).hintMode ?? "always") as import("@/types").HintMode,
            sort_order:        m.sortOrder,
            timing:            null,
            tap_destination_id: (m as { tapDestinationId?: string | null }).tapDestinationId ?? null,
            tap_url:            (m as { tapUrl?: string | null }).tapUrl ?? null,
            character:         m.character
              ? {
                  id:             m.character.id,
                  name:           m.character.name,
                  icon_type:      m.character.iconType as import("@/types").IconType,
                  icon_text:      m.character.iconText,
                  icon_color:     m.character.iconColor,
                  icon_image_url: m.character.iconImageUrl,
                }
              : null,
          };
        }

        const matched = responseRows.filter((m) => {
          if (!m.triggerKeyword) return false;
          // 複数キーワード（\n 区切り）のいずれかと一致すれば OK
          return m.triggerKeyword.split("\n").map((k: string) => norm(k.trim())).some((kw: string) => kw === normLabel);
        });

        // LINE の buildMessageChain と同様に nextMessageId チェーンを辿る。
        // QR を持つメッセージには停止しない（LINE 側と同じ挙動）。
        // ただしテスト画面では /api/runtime/message が QR 手前で停止するため、
        // ここでは各 triggerKeyword マッチメッセージのチェーンをすべて展開して返す。
        const msgMap = new Map(responseRows.map((m) => [m.id, m]));
        const visited = new Set<string>();
        for (const first of matched) {
          let cur: ResponseRow | undefined = first;
          let depth = 0;
          while (cur && !visited.has(cur.id) && depth < 5) {
            visited.add(cur.id);
            responseMessages.push(rowToRuntimeMsg(cur));
            // QR を持つメッセージで停止（ユーザーの次の選択を待つ）
            if (cur.quickReplies) break;
            const nextId: string | null = cur.nextMessageId;
            if (!nextId) break;
            // nextMessageId が同フェーズ内にあれば辿る
            cur = msgMap.get(nextId);
            if (!cur) {
              // フェーズをまたぐ場合は DB から取得
              const fetched: ResponseRow | null = await prisma.message.findUnique({
                where:   { id: nextId, isActive: true },
                include: { character: { select: { id: true, name: true, iconType: true, iconText: true, iconColor: true, iconImageUrl: true } } },
              });
              cur = fetched ?? undefined;
            }
            depth++;
          }
        }
      }

      return ok({
        ...state,
        _message:
          availableLabels.length > 0
            ? `選択肢に一致しませんでした。次のいずれかを選んでください: ${availableLabels.join(" / ")}`
            : "このフェーズには有効な遷移がありません。",
        _matched: false,
        ...(responseMessages.length > 0 ? { _response_messages: responseMessages } : {}),
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
        isPreview,
        previewBy,
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
