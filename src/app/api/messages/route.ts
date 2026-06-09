// src/app/api/messages/route.ts
// GET  /api/messages?work_id=xxx — メッセージ一覧取得
// POST /api/messages               — メッセージ作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { getCachedOaById } from "@/lib/oa-cache";
import { createMessageSchema, messageQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";
// OnboardingEvent write 停止済み（Phase 3）— trackOnboardingStep import を削除
import { trackOnboardingProgress } from "@/lib/onboarding";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";
import { messageToResponse as toResponse } from "@/lib/api/list-shapes";

export const dynamic = "force-dynamic";

// ── GET /api/messages ────────────────────────────
export const GET = withAuth(async (req, _ctx, user) =>
  runWithRequestId(genRequestId(), () => withTiming("api/messages:GET", async () => {
  try {
    const { searchParams } = new URL(req.url);
    const query = messageQuerySchema.parse({
      work_id:        searchParams.get("work_id")        ?? undefined,
      phase_id:       searchParams.get("phase_id")       ?? undefined,
      character_id:   searchParams.get("character_id")   ?? undefined,
      message_type:   searchParams.get("message_type")   ?? undefined,
      is_active:      searchParams.get("is_active")      ?? undefined,
      with_relations: searchParams.get("with_relations") ?? undefined,
    });

    // PR #159: prisma.work.findUnique で oaId も同時取得 (= getOaIdFromWorkId 重複削除)
    // PR #160: 取得した oaId で getCachedOaById → preloadedOa を requireRole に渡して
    //          requireRole 内部の Oa.findUnique をスキップする (warm hit 時 ~500ms 短縮)。
    // auth ロジックの結果は不変 (= ownerKey ベースの owner 判定 + WorkspaceMember fallback)。
    const work = await withTiming("api/messages:db:work", () =>
      prisma.work.findUnique({
        where:  { id: query.work_id },
        select: { id: true, oaId: true },
      }),
    );
    if (!work) return notFound("作品");

    const oaId = work.oaId;
    if (oaId) {
      const cachedOa = await withTiming("api/messages:db:oa", () => getCachedOaById(oaId));
      if (!cachedOa) return notFound("OA");
      const check = await requireRole(oaId, user.id, 'viewer', {
        preloadedOa: { ownerKey: cachedOa.ownerKey },
      });
      if (!check.ok) return check.response;
    }

    const messages = await withTiming("api/messages:db:list", () =>
      prisma.message.findMany({
        where: {
          workId:      query.work_id,
          ...(query.phase_id     && { phaseId:     query.phase_id }),
          ...(query.character_id && { characterId: query.character_id }),
          ...(query.message_type && { messageType: query.message_type as "text" | "image" | "button" }),
          ...(query.is_active !== undefined && { isActive: query.is_active }),
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        ...(query.with_relations && {
          include: {
            phase: {
              select: { id: true, name: true, phaseType: true },
            },
            character: {
              select: { id: true, name: true, iconType: true, iconText: true, iconImageUrl: true, iconColor: true },
            },
          },
        }),
      }),
    );

    return await withTiming("api/messages:shape", async () => ok(messages.map(toResponse)));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
  }))
);

// ── POST /api/messages ───────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    console.log("[POST /api/messages] raw body:", JSON.stringify(body, null, 2));
    const data = createMessageSchema.parse(body);

    // Work 存在確認 + oaId 取得 (GET と同じ dedup パターン: 1 回の lookup で 2 用途を満たす)
    // PR #160: getCachedOaById + preloadedOa で requireRole 内部の Oa.findUnique をスキップ。
    const work = await prisma.work.findUnique({
      where:  { id: data.work_id },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");

    const oaId = work.oaId;
    if (oaId) {
      const cachedOa = await getCachedOaById(oaId);
      if (!cachedOa) return notFound("OA");
      const check = await requireRole(oaId, user.id, 'tester', {
        preloadedOa: { ownerKey: cachedOa.ownerKey },
      });
      if (!check.ok) return check.response;
    }

    // Phase 存在確認（指定時）
    if (data.phase_id) {
      const phase = await prisma.phase.findUnique({ where: { id: data.phase_id } });
      if (!phase) return notFound("フェーズ");
      if (phase.workId !== data.work_id) return badRequest("指定したフェーズはこの作品に属していません");
    }

    // Character 存在確認（指定時）
    if (data.character_id) {
      const character = await prisma.character.findUnique({ where: { id: data.character_id } });
      if (!character) return notFound("キャラクター");
      if (character.workId !== data.work_id) return badRequest("指定したキャラクターはこの作品に属していません");
    }

    // DB 保存前ログ（quick_replies の内容と JSON 化後の文字列を確認）
    const quickRepliesJson = data.quick_replies ? JSON.stringify(data.quick_replies) : null;
    console.log(
      `[POST /api/messages] 保存前 quick_replies: count=${data.quick_replies?.length ?? 0}`,
      quickRepliesJson ?? "null"
    );

    const message = await prisma.message.create({
      data: {
        workId:             data.work_id,
        phaseId:            data.phase_id      ?? null,
        characterId:        data.character_id  ?? null,
        messageType:        data.message_type,
        kind:               data.kind,
        body:               data.body          ?? null,
        assetUrl:           data.asset_url     ?? null,
        triggerKeyword:     data.trigger_keyword ?? null,
        targetSegment:      data.target_segment  ?? null,
        notifyText:         data.notify_text     ?? null,
        riddleId:           data.riddle_id       ?? null,
        quickReplies:       quickRepliesJson,
        nextMessageId:      data.next_message_id   ?? null,
        altText:            data.alt_text          ?? null,
        flexPayloadJson:    data.flex_payload_json ?? null,
        puzzleType:         data.puzzle_type        ?? null,
        answer:             data.answer             ?? null,
        puzzleHintText:     data.puzzle_hint_text   ?? null,
        hintMode:           data.hint_mode ?? "always",
        answerMatchType:    data.answer_match_type ? JSON.stringify(data.answer_match_type) : JSON.stringify(["exact"]),
        correctAction:      data.correct_action      ?? null,
        correctText:          data.correct_text        ?? null,
        incorrectText:        data.incorrect_text      ?? null,
        incorrectQuickReplies: data.incorrect_quick_replies ? JSON.stringify(data.incorrect_quick_replies) : null,
        correctNextPhaseId:   data.correct_next_phase_id ?? null,
        lagMs:              data.lag_ms ?? 0,
        // 演出設定
        readReceiptMode:    data.read_receipt_mode    ?? null,
        readDelayMs:        data.read_delay_ms        ?? null,
        typingEnabled:      data.typing_enabled       ?? null,
        typingMinMs:        data.typing_min_ms        ?? null,
        typingMaxMs:        data.typing_max_ms        ?? null,
        loadingEnabled:     data.loading_enabled      ?? null,
        loadingThresholdMs: data.loading_threshold_ms ?? null,
        loadingMinSeconds:  data.loading_min_seconds  ?? null,
        loadingMaxSeconds:  data.loading_max_seconds  ?? null,
        // タップ遷移先
        tapDestinationId:   data.tap_destination_id   ?? null,
        tapUrl:             data.tap_url              ?? null,
        // 画像タップ時アクション
        imageActionType:         data.image_action_type === "none" ? null : (data.image_action_type ?? null),
        imageActionText:         data.image_action_text         ?? null,
        imageActionUrl:          data.image_action_url          ?? null,
        imageActionLiffPageId:   data.image_action_liff_page_id ?? null,
        imageActionPostbackData: data.image_action_postback_data ?? null,
        // 自由入力受付（schema・Zod・form は揃っていたが POST data に欠落していた pre-existing bug を修正）
        freeInputEnabled:       data.free_input_enabled ?? false,
        freeInputVariableKey:   data.free_input_variable_key ?? null,
        freeInputNextMessageId: data.free_input_next_message_id ?? null,
        sortOrder:          data.sort_order,
        isActive:           data.is_active,
      },
      include: {
        phase: {
          select: { id: true, name: true, phaseType: true },
        },
        character: {
          select: {
            id: true, name: true, iconType: true,
            iconText: true, iconImageUrl: true, iconColor: true,
          },
        },
      },
    });

    // キャッシュ無効化（新規メッセージが追加されたフェーズ / グローバルキーワード）
    if (data.phase_id) {
      // global フェーズへのメッセージ追加は globalKw キャッシュを無効化
      if (message.phase?.phaseType === "global") {
        await activeCache.delete(CACHE_KEY.globalKw(data.work_id));
      } else {
        await activeCache.delete(CACHE_KEY.phase(data.phase_id));
        await activeCache.delete(CACHE_KEY.startMsgs(data.phase_id));
      }
    } else {
      await activeCache.delete(CACHE_KEY.globalKw(data.work_id));
    }

    // オンボーディングステップ記録（fire-and-forget）
    trackOnboardingProgress({ userId: user.id, workId: data.work_id, step: "message_created" });

    return created(toResponse(message));
  } catch (err) {
    if (err instanceof ZodError) {
      const details = formatZodErrors(err);
      console.error("[POST /api/messages] ZodError:", JSON.stringify(details, null, 2));
      return badRequest("入力値が不正です", details);
    }
    return serverError(err);
  }
});
