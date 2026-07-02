// src/app/api/messages/[id]/route.ts
// GET    /api/messages/:id — メッセージ詳細（リレーション込み）
// PATCH  /api/messages/:id — メッセージ更新（リレーション込みで返す）
// DELETE /api/messages/:id — メッセージ削除

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, unprocessable, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { getCurrentPlanTierForOa } from "@/lib/plan-guard";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import { updateMessageSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { parseAnswerMatchType, parsePuzzleAnswers } from "@/lib/puzzle-answer";
import { toBigIntOrNull, bigintToJson } from "@/lib/media-validation";
import { findExternalReferrers, REFERRER_KIND_LABEL, type RefMessage } from "@/lib/message-refs";

// Next.js の自動 static 化を防ぐ。withAuth が headers/cookies を読むため通常は dynamic 扱いだが
// defensive に明示する（POST 側 route.ts と揃える）。
export const dynamic = "force-dynamic";

// ── リレーション include 定義（GET・PATCH 共通） ────────────
const MESSAGE_INCLUDE = {
  phase: {
    select: { id: true, name: true, phaseType: true },
  },
  character: {
    select: {
      id: true, name: true, iconType: true,
      iconText: true, iconImageUrl: true, iconColor: true,
    },
  },
} as const;

type PrismaMessageWithRelations = {
  id: string; workId: string; phaseId: string | null; characterId: string | null;
  messageType: string; kind: string; body: string | null; assetUrl: string | null;
  assetMediaSource: string | null; assetPreviewUrl: string | null; assetMimeType: string | null;
  assetFileSizeBytes: bigint | null; assetDurationMs: number | null;
  assetWidth: number | null; assetHeight: number | null; assetUsage: string | null;
  triggerKeyword: string | null; targetSegment: string | null;
  notifyText: string | null; riddleId: string | null;
  quickReplies: string | null; nextMessageId: string | null;
  altText: string | null; flexPayloadJson: string | null;
  puzzleType: string | null; answer: string | null; answers: string | null; puzzleHintText: string | null;
  answerMatchType: string | null; correctAction: string | null;
  correctText: string | null; correctCharacterId: string | null;
  incorrectText: string | null; incorrectCharacterId: string | null;
  incorrectQuickReplies: string | null;
  correctNextPhaseId: string | null;
  hintMode: string;
  lagMs: number;
  // 演出設定
  readReceiptMode: string | null;
  readDelayMs: number | null;
  typingEnabled: boolean | null;
  typingMinMs: number | null;
  typingMaxMs: number | null;
  loadingEnabled: boolean | null;
  loadingThresholdMs: number | null;
  loadingMinSeconds: number | null;
  loadingMaxSeconds: number | null;
  // タップ遷移先
  tapDestinationId: string | null;
  tapUrl: string | null;
  // 画像タップ時アクション
  imageActionType: string | null;
  imageActionText: string | null;
  imageActionUrl: string | null;
  imageActionLiffPageId: string | null;
  imageActionPostbackData: string | null;
  imageActionPhaseId: string | null;
  // 自由入力受付
  freeInputEnabled: boolean;
  freeInputVariableKey: string | null;
  freeInputNextMessageId: string | null;
  // 送信後の待機トリガー（地点到着で自動進行）
  checkinTriggerType: string | null;
  checkinTriggerLocationId: string | null;
  checkinTriggerNextMessageId: string | null;
  checkinTriggerNextPhaseId: string | null;
  scheduledMessageSettings: string | null;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  phase:     { id: string; name: string; phaseType: string } | null;
  character: {
    id: string; name: string; iconType: string;
    iconText: string | null; iconImageUrl: string | null; iconColor: string | null;
  } | null;
};

function parseQuickReplies(raw: string | null, msgId?: string) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[parseQuickReplies] quick_replies は配列ではありません id=${msgId ?? "?"} raw=${raw.slice(0, 80)}`);
      return null;
    }
    return parsed;
  } catch {
    console.warn(`[parseQuickReplies] JSON パース失敗 id=${msgId ?? "?"} raw=${raw.slice(0, 80)}`);
    return null;
  }
}

// ── snake_case 変換（GET / PATCH 共通） ─────────────────────
function toResponse(m: PrismaMessageWithRelations) {
  // 時間差メッセージ設定（保存のみ）。再編集画面で値を復元できるよう JSON を安全に parse して返す。
  let scheduledMessageSettings: unknown = null;
  if (m.scheduledMessageSettings) {
    try { scheduledMessageSettings = JSON.parse(m.scheduledMessageSettings); } catch { scheduledMessageSettings = null; }
  }
  return {
    id:                    m.id,
    work_id:               m.workId,
    phase_id:              m.phaseId,
    character_id:          m.characterId,
    message_type:          m.messageType,
    kind:                  m.kind,
    body:                  m.body,
    asset_url:             m.assetUrl,
    asset_media_source:    m.assetMediaSource,
    asset_preview_url:     m.assetPreviewUrl,
    asset_mime_type:       m.assetMimeType,
    asset_file_size_bytes: bigintToJson(m.assetFileSizeBytes),
    asset_duration_ms:     m.assetDurationMs,
    asset_width:           m.assetWidth,
    asset_height:          m.assetHeight,
    asset_usage:           m.assetUsage,
    trigger_keyword:       m.triggerKeyword,
    target_segment:        m.targetSegment,
    notify_text:           m.notifyText,
    riddle_id:             m.riddleId,
    quick_replies:         parseQuickReplies(m.quickReplies, m.id),
    next_message_id:       m.nextMessageId,
    alt_text:              m.altText,
    flex_payload_json:     m.flexPayloadJson,
    puzzle_type:           m.puzzleType,
    answer:                m.answer,
    answers:               parsePuzzleAnswers(m.answers),
    puzzle_hint_text:      m.puzzleHintText,
    answer_match_type:     parseAnswerMatchType(m.answerMatchType),
    correct_action:        m.correctAction,
    correct_text:            m.correctText,
    correct_character_id:    m.correctCharacterId ?? null,
    incorrect_text:          m.incorrectText,
    incorrect_character_id:  m.incorrectCharacterId ?? null,
    incorrect_quick_replies: parseQuickReplies(m.incorrectQuickReplies, m.id),
    correct_next_phase_id:   m.correctNextPhaseId,
    hint_mode:             m.hintMode as import("@/types").HintMode,
    lag_ms:                m.lagMs,
    // 演出設定
    read_receipt_mode:     (m.readReceiptMode as import("@/types").ReadReceiptMode) ?? null,
    read_delay_ms:         m.readDelayMs ?? null,
    typing_enabled:        m.typingEnabled ?? null,
    typing_min_ms:         m.typingMinMs ?? null,
    typing_max_ms:         m.typingMaxMs ?? null,
    loading_enabled:       m.loadingEnabled ?? null,
    loading_threshold_ms:  m.loadingThresholdMs ?? null,
    loading_min_seconds:   m.loadingMinSeconds ?? null,
    loading_max_seconds:   m.loadingMaxSeconds ?? null,
    // タップ遷移先
    tap_destination_id:    m.tapDestinationId ?? null,
    tap_url:               m.tapUrl ?? null,
    // 画像タップ時アクション
    image_action_type:          m.imageActionType         ?? null,
    image_action_text:          m.imageActionText         ?? null,
    image_action_url:           m.imageActionUrl          ?? null,
    image_action_liff_page_id:  m.imageActionLiffPageId   ?? null,
    image_action_postback_data: m.imageActionPostbackData ?? null,
    image_action_phase_id:      m.imageActionPhaseId      ?? null,
    // 自由入力受付
    free_input_enabled:         m.freeInputEnabled         ?? false,
    free_input_variable_key:    m.freeInputVariableKey     ?? null,
    free_input_next_message_id: m.freeInputNextMessageId   ?? null,
    // 送信後の待機トリガー（地点到着で自動進行）
    checkin_trigger_type:             m.checkinTriggerType          ?? null,
    checkin_trigger_location_id:      m.checkinTriggerLocationId    ?? null,
    checkin_trigger_next_message_id:  m.checkinTriggerNextMessageId ?? null,
    checkin_trigger_next_phase_id:    m.checkinTriggerNextPhaseId   ?? null,
    scheduled_message_settings:       scheduledMessageSettings,
    sort_order:            m.sortOrder,
    is_active:             m.isActive,
    created_at:            m.createdAt,
    updated_at:            m.updatedAt,
    phase: m.phase
      ? { id: m.phase.id, name: m.phase.name, phase_type: m.phase.phaseType }
      : null,
    character: m.character
      ? {
          id:             m.character.id,
          name:           m.character.name,
          icon_type:      m.character.iconType,
          icon_text:      m.character.iconText,
          icon_image_url: m.character.iconImageUrl,
          icon_color:     m.character.iconColor,
        }
      : null,
  };
}

// ── GET /api/messages/:id ────────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const message = await prisma.message.findUnique({
      where:   { id: params.id },
      include: {
        ...MESSAGE_INCLUDE,
        work: { select: { oaId: true } },
      },
    });
    if (!message) return notFound("メッセージ");

    const check = await requireRole(message.work.oaId, user.id, 'viewer');
    if (!check.ok) return check.response;

    return ok(toResponse(message));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/messages/:id ──────────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.message.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("メッセージ");

    const check = await requireRole(existing.work.oaId, user.id, 'tester');
    if (!check.ok) return check.response;

    const body = await req.json();
    console.log(`[PATCH /api/messages/${params.id}] raw body:`, JSON.stringify(body, null, 2));
    const data = updateMessageSchema.parse(body);

    // プラン制限: ロケーション関連設定（checkin_trigger_*）は location feature 許可プランのみ更新可。
    // 非許可プラン or 判定不能では checkin_trigger_* の書き込みを「丸ごとスキップ」する
    // （= 既存値を維持。非 Pro Max が編集保存しても過去のロケーション設定を null にしない）。
    const locationAllowed = existing.work.oaId
      ? getPlanAccessState({ plan: await getCurrentPlanTierForOa(existing.work.oaId), featureKey: FEATURE.location }).allowed
      : false;

    // Phase 存在・所属確認（変更時）
    if (data.phase_id !== undefined && data.phase_id !== null) {
      const phase = await prisma.phase.findUnique({ where: { id: data.phase_id } });
      if (!phase) return notFound("フェーズ");
      if (phase.workId !== existing.workId) return badRequest("指定したフェーズはこの作品に属していません");
    }

    // Character 存在・所属確認（変更時）
    if (data.character_id !== undefined && data.character_id !== null) {
      const character = await prisma.character.findUnique({ where: { id: data.character_id } });
      if (!character) return notFound("キャラクター");
      if (character.workId !== existing.workId) return badRequest("指定したキャラクターはこの作品に属していません");
    }

    // 時間差メッセージ設定（PR-4c-1: 保存のみ）。発話キャラは同一 work のみ許可。
    let scheduledMessageSettingsJson: string | null | undefined = undefined;
    if (data.scheduled_message_settings !== undefined) {
      if (data.scheduled_message_settings === null) {
        scheduledMessageSettingsJson = null;
      } else {
        const s = data.scheduled_message_settings;
        if (s.character_id) {
          const ch = await prisma.character.findUnique({ where: { id: s.character_id } });
          if (!ch) return notFound("キャラクター");
          if (ch.workId !== existing.workId) return badRequest("時間差メッセージの発話キャラクターはこの作品に属していません");
        }
        scheduledMessageSettingsJson = JSON.stringify(s);
      }
    }

    // 既存レコードと変更後の値を合わせた整合性チェック（create と同等）
    const nextType     = data.message_type ?? existing.messageType;
    const nextBody     = data.body      !== undefined ? data.body      : existing.body;
    const nextAssetUrl = data.asset_url !== undefined ? data.asset_url : existing.assetUrl;

    if (nextType === "text" && !nextBody) {
      return badRequest("message_type が text の場合、body は必須です", {
        body: ["text型の場合は本文が必要です"],
      });
    }
    if ((nextType === "image" || nextType === "video" || nextType === "voice") && !nextAssetUrl) {
      return badRequest(`message_type が ${nextType} の場合、asset_url は必須です`, {
        asset_url: [`${nextType}型の場合は asset_url が必要です`],
      });
    }

    // DB 保存前ログ（quick_replies の内容と JSON 化後の文字列を確認）
    if (data.quick_replies !== undefined) {
      const quickRepliesJson = data.quick_replies ? JSON.stringify(data.quick_replies) : null;
      console.log(
        `[PATCH /api/messages/${params.id}] 保存前 quick_replies: count=${data.quick_replies?.length ?? 0}`,
        quickRepliesJson ?? "null"
      );
    }

    // hint_mode は Prisma クライアントのバージョン差を回避するため $executeRaw で更新する
    // （`prisma generate` 前のサーバーインスタンスでも安全に動作させるため）
    if (data.hint_mode !== undefined) {
      await prisma.$executeRaw`UPDATE messages SET hint_mode = ${data.hint_mode} WHERE id = ${params.id}`;
    }

    const updated = await prisma.message.update({
      where: { id: params.id },
      data: {
        ...(data.phase_id        !== undefined && { phaseId:        data.phase_id }),
        ...(data.character_id    !== undefined && { characterId:    data.character_id }),
        ...(data.message_type    !== undefined && { messageType:    data.message_type }),
        ...(data.kind            !== undefined && { kind:           data.kind }),
        ...(data.body            !== undefined && { body:           data.body }),
        ...(data.asset_url       !== undefined && { assetUrl:       data.asset_url }),
        ...(data.asset_media_source    !== undefined && { assetMediaSource:   data.asset_media_source }),
        ...(data.asset_preview_url     !== undefined && { assetPreviewUrl:    data.asset_preview_url }),
        ...(data.asset_mime_type       !== undefined && { assetMimeType:      data.asset_mime_type }),
        ...(data.asset_file_size_bytes !== undefined && { assetFileSizeBytes: toBigIntOrNull(data.asset_file_size_bytes) }),
        ...(data.asset_duration_ms     !== undefined && { assetDurationMs:    data.asset_duration_ms }),
        ...(data.asset_width           !== undefined && { assetWidth:         data.asset_width }),
        ...(data.asset_height          !== undefined && { assetHeight:        data.asset_height }),
        ...(data.asset_usage           !== undefined && { assetUsage:         data.asset_usage }),
        ...(data.trigger_keyword !== undefined && { triggerKeyword: data.trigger_keyword }),
        ...(data.target_segment  !== undefined && { targetSegment:  data.target_segment }),
        ...(data.notify_text     !== undefined && { notifyText:     data.notify_text }),
        ...(data.riddle_id       !== undefined && { riddleId:       data.riddle_id }),
        ...(data.quick_replies   !== undefined && {
          quickReplies: data.quick_replies ? JSON.stringify(data.quick_replies) : null,
        }),
        ...(data.next_message_id !== undefined && { nextMessageId:   data.next_message_id }),
        ...(data.alt_text          !== undefined && { altText:         data.alt_text }),
        ...(data.flex_payload_json !== undefined && { flexPayloadJson: data.flex_payload_json }),
        ...(data.puzzle_type       !== undefined && { puzzleType:      data.puzzle_type }),
        ...(data.answer            !== undefined && { answer:          data.answer }),
        ...(data.puzzle_hint_text  !== undefined && { puzzleHintText:  data.puzzle_hint_text }),
        // hint_mode は $executeRaw で別途更新するためここでは除外
        ...(data.answer_match_type !== undefined && {
          answerMatchType: JSON.stringify(data.answer_match_type),
        }),
        ...(data.answers              !== undefined && {
          answers: data.answers && data.answers.length > 0 ? JSON.stringify(data.answers) : null,
        }),
        ...(data.correct_action       !== undefined && { correctAction:      data.correct_action }),
        ...(data.correct_text         !== undefined && { correctText:        data.correct_text }),
        ...(data.correct_character_id !== undefined && { correctCharacterId:   data.correct_character_id }),
        ...(data.incorrect_text       !== undefined && { incorrectText:         data.incorrect_text }),
        ...(data.incorrect_character_id !== undefined && { incorrectCharacterId: data.incorrect_character_id }),
        ...(data.incorrect_quick_replies !== undefined && {
          incorrectQuickReplies: data.incorrect_quick_replies ? JSON.stringify(data.incorrect_quick_replies) : null,
        }),
        ...(data.correct_next_phase_id !== undefined && { correctNextPhaseId: data.correct_next_phase_id }),
        ...(data.lag_ms            !== undefined && { lagMs:           data.lag_ms }),
        // 演出設定
        ...(data.read_receipt_mode    !== undefined && { readReceiptMode:    data.read_receipt_mode }),
        ...(data.read_delay_ms        !== undefined && { readDelayMs:        data.read_delay_ms }),
        ...(data.typing_enabled       !== undefined && { typingEnabled:      data.typing_enabled }),
        ...(data.typing_min_ms        !== undefined && { typingMinMs:        data.typing_min_ms }),
        ...(data.typing_max_ms        !== undefined && { typingMaxMs:        data.typing_max_ms }),
        ...(data.loading_enabled      !== undefined && { loadingEnabled:     data.loading_enabled }),
        ...(data.loading_threshold_ms !== undefined && { loadingThresholdMs: data.loading_threshold_ms }),
        ...(data.loading_min_seconds  !== undefined && { loadingMinSeconds:  data.loading_min_seconds }),
        ...(data.loading_max_seconds  !== undefined && { loadingMaxSeconds:  data.loading_max_seconds }),
        // タップ遷移先
        ...(data.tap_destination_id !== undefined && { tapDestinationId: data.tap_destination_id }),
        ...(data.tap_url            !== undefined && { tapUrl:           data.tap_url }),
        // 画像タップ時アクション
        ...(data.image_action_type !== undefined && {
          imageActionType: data.image_action_type === "none" ? null : data.image_action_type
        }),
        ...(data.image_action_text         !== undefined && { imageActionText:         data.image_action_text }),
        ...(data.image_action_url          !== undefined && { imageActionUrl:          data.image_action_url }),
        ...(data.image_action_liff_page_id !== undefined && { imageActionLiffPageId:   data.image_action_liff_page_id }),
        ...(data.image_action_postback_data !== undefined && { imageActionPostbackData: data.image_action_postback_data }),
        // message_with_phase 以外に切り替えたら phase_id は null に寄せる。
        ...(data.image_action_type !== undefined && { imageActionPhaseId: data.image_action_type === "message_with_phase" ? (data.image_action_phase_id ?? null) : null }),
        // 自由入力受付（schema・Zod・form は揃っていたが PATCH data に欠落していた pre-existing bug を修正）
        ...(data.free_input_enabled         !== undefined && { freeInputEnabled:       data.free_input_enabled }),
        ...(data.free_input_variable_key    !== undefined && { freeInputVariableKey:   data.free_input_variable_key }),
        ...(data.free_input_next_message_id !== undefined && { freeInputNextMessageId: data.free_input_next_message_id }),
        // 送信後の待機トリガー（地点到着で自動進行）。種別が payload にあれば 4 列を整合的に更新（種別 null で全クリア）。
        // location 非許可プランでは丸ごとスキップ＝既存値を維持（誤って null 化しない）。
        ...(locationAllowed && data.checkin_trigger_type !== undefined && {
          checkinTriggerType:          data.checkin_trigger_type ?? null,
          checkinTriggerLocationId:    data.checkin_trigger_type ? (data.checkin_trigger_location_id ?? null) : null,
          checkinTriggerNextMessageId: data.checkin_trigger_type ? (data.checkin_trigger_next_message_id ?? null) : null,
          checkinTriggerNextPhaseId:   data.checkin_trigger_type ? (data.checkin_trigger_next_phase_id ?? null) : null,
        }),
        // 時間差メッセージ設定（保存のみ・runtime 未使用）。payload に含まれるときのみ更新。
        ...(scheduledMessageSettingsJson !== undefined && { scheduledMessageSettings: scheduledMessageSettingsJson }),
        ...(data.sort_order        !== undefined && { sortOrder:       data.sort_order }),
        ...(data.is_active         !== undefined && { isActive:        data.is_active }),
      },
      include: MESSAGE_INCLUDE,
    });

    // キャッシュ無効化（フェーズ内容・グローバルキーワードが変化する可能性があるため両方）
    // phaseId が変わった場合: 旧フェーズも新フェーズも無効化する
    const prevPhaseId = existing.phaseId;
    const nextPhaseId = data.phase_id !== undefined ? data.phase_id : existing.phaseId;
    if (prevPhaseId) {
      await activeCache.delete(CACHE_KEY.phase(prevPhaseId));
      // kind="start" メッセージの変更は startMsgs キャッシュも無効化する
      await activeCache.delete(CACHE_KEY.startMsgs(prevPhaseId));
    }
    if (nextPhaseId && nextPhaseId !== prevPhaseId) {
      await activeCache.delete(CACHE_KEY.phase(nextPhaseId));
      await activeCache.delete(CACHE_KEY.startMsgs(nextPhaseId));
    }
    // phaseId = null（グローバルキーワード）の変更
    if (prevPhaseId === null || nextPhaseId === null) {
      await activeCache.delete(CACHE_KEY.globalKw(existing.workId));
    }
    // global フェーズのメッセージ変更は globalKw キャッシュも無効化
    if (updated.phase?.phaseType === "global") {
      await activeCache.delete(CACHE_KEY.globalKw(existing.workId));
    }

    const response = toResponse(updated);
    // hint_mode は $executeRaw で直接更新済み。レスポンスに確実に反映する
    if (data.hint_mode !== undefined) {
      response.hint_mode = data.hint_mode;
    }

    return ok(response);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = formatZodErrors(err);
      console.error(`[PATCH /api/messages/${params.id}] ZodError:`, JSON.stringify(details, null, 2));
      return badRequest("入力値が不正です", details);
    }
    console.error(`[PATCH /api/messages/${params.id}] UNEXPECTED ERROR:`, err);
    return serverError(err);
  }
});

// ── DELETE /api/messages/:id ─────────────────────
//
// 仕様: chain head (= next_message_id で連結された連続メッセージの先頭) を削除すると、
//   chain 内の continuation メッセージ (msg2, msg3, ...) も一括削除する。
//   理由: chain continuation は一覧では非表示で、独立操作対象ではないため、
//   親 (chain head) と一緒に消える方が UX 上自然 (= 確認ダイアログ「関連する...設定も削除されます」と整合)。
//
//   safeguards:
//   - 同じ work_id に属する message のみを chain として walk する (= 他 work 混入防止)
//   - 循環参照を visited Set で防止
//   - 上限 10 件 (= LINE 5 件 chain の倍を保険として)
//   - transaction で一括 delete (= 中途半端な状態回避)
export const DELETE = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.message.findUnique({
      where: { id: params.id },
      include: {
        work: { select: { oaId: true } },
        phase: { select: { phaseType: true } },
      },
    });
    if (!existing) return notFound("メッセージ");

    // 作品配下コンテンツの削除は editor 以上に緩和（制作者が編集作業の一環で削除できる）。
    // 作品/OA 削除のような高リスク操作は別途 owner 限定のまま。
    const check = await requireRole(existing.work.oaId, user.id, 'editor');
    if (!check.ok) return check.response;

    // chain continuation を walk して削除対象 ID を集める
    const idsToDelete: string[] = [existing.id];
    const visited = new Set<string>([existing.id]);
    let currentNextId: string | null = existing.nextMessageId ?? null;
    for (let i = 0; i < 10 && currentNextId; i++) {
      if (visited.has(currentNextId)) break;  // = 循環防止
      const next = await prisma.message.findUnique({
        where: { id: currentNextId },
        select: { id: true, workId: true, nextMessageId: true },
      });
      if (!next) break;
      if (next.workId !== existing.workId) break;  // = 別 work への跨ぎは追わない
      visited.add(next.id);
      idsToDelete.push(next.id);
      currentNextId = next.nextMessageId ?? null;
    }

    // ── 逆参照ガード（#6-4b）─────────────────────────────────────────
    // 削除対象集合（対象 + 連鎖削除される後続）の「外側」から next / freeInputNext /
    // QR target / QR response で参照されていたら、ダングリング参照を防ぐため 422 でブロックする。
    // 集合内部同士の参照（A→B→C をまとめて削除）はブロックしない。
    const workMessages = await prisma.message.findMany({
      where:  { workId: existing.workId },
      select: { id: true, body: true, messageType: true, nextMessageId: true, freeInputNextMessageId: true, quickReplies: true },
    });
    const refMessages: RefMessage[] = workMessages.map((m) => ({
      id: m.id, body: m.body, message_type: m.messageType,
      next_message_id: m.nextMessageId, free_input_next_message_id: m.freeInputNextMessageId,
      quick_replies: m.quickReplies,
    }));
    const externalReferrers = findExternalReferrers(idsToDelete, refMessages);
    if (externalReferrers.length > 0) {
      const referrers = externalReferrers.map((r) => ({
        referrerId:    r.referrerId,
        referrerLabel: r.referrerLabel,
        kind:          r.kind,
        kindLabel:     REFERRER_KIND_LABEL[r.kind],
        targetId:      r.targetId,
      }));
      return unprocessable(
        "このメッセージは他のメッセージから参照されているため削除できません。先に参照元を変更してください。",
        "REFERENCE_GUARD",
        { referrers },
      );
    }

    // transaction で一括削除
    await prisma.$transaction(
      idsToDelete.map((id) => prisma.message.delete({ where: { id } })),
    );

    // キャッシュ無効化
    if (existing.phaseId) {
      if (existing.phase?.phaseType === "global") {
        await activeCache.delete(CACHE_KEY.globalKw(existing.workId));
      } else {
        await activeCache.delete(CACHE_KEY.phase(existing.phaseId));
        // kind="start" メッセージの削除は startMsgs キャッシュも無効化する
        await activeCache.delete(CACHE_KEY.startMsgs(existing.phaseId));
      }
    } else {
      await activeCache.delete(CACHE_KEY.globalKw(existing.workId));
    }

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
