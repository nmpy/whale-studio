// src/app/api/messages/[id]/route.ts
// GET    /api/messages/:id — メッセージ詳細（リレーション込み）
// PATCH  /api/messages/:id — メッセージ更新（リレーション込みで返す）
// DELETE /api/messages/:id — メッセージ削除

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateMessageSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

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
  triggerKeyword: string | null; targetSegment: string | null;
  notifyText: string | null; riddleId: string | null;
  quickReplies: string | null; nextMessageId: string | null;
  altText: string | null; flexPayloadJson: string | null;
  puzzleType: string | null; answer: string | null; puzzleHintText: string | null;
  answerMatchType: string | null; correctAction: string | null;
  correctText: string | null; incorrectText: string | null;
  incorrectQuickReplies: string | null;
  correctNextPhaseId: string | null;
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

function parseAnswerMatchType(raw: string | null): string[] {
  if (!raw) return ["exact"];
  try { return JSON.parse(raw); } catch { return ["exact"]; }
}

// ── snake_case 変換（GET / PATCH 共通） ─────────────────────
function toResponse(m: PrismaMessageWithRelations) {
  return {
    id:                    m.id,
    work_id:               m.workId,
    phase_id:              m.phaseId,
    character_id:          m.characterId,
    message_type:          m.messageType,
    kind:                  m.kind,
    body:                  m.body,
    asset_url:             m.assetUrl,
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
    puzzle_hint_text:      m.puzzleHintText,
    answer_match_type:     parseAnswerMatchType(m.answerMatchType),
    correct_action:        m.correctAction,
    correct_text:            m.correctText,
    incorrect_text:          m.incorrectText,
    incorrect_quick_replies: parseQuickReplies(m.incorrectQuickReplies, m.id),
    correct_next_phase_id:   m.correctNextPhaseId,
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

    const check = await requireRole(existing.work.oaId, user.id, 'editor');
    if (!check.ok) return check.response;

    const body = await req.json();
    console.log(`[PATCH /api/messages/${params.id}] raw body:`, JSON.stringify(body, null, 2));
    const data = updateMessageSchema.parse(body);

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

    const updated = await prisma.message.update({
      where: { id: params.id },
      data: {
        ...(data.phase_id        !== undefined && { phaseId:        data.phase_id }),
        ...(data.character_id    !== undefined && { characterId:    data.character_id }),
        ...(data.message_type    !== undefined && { messageType:    data.message_type }),
        ...(data.kind            !== undefined && { kind:           data.kind }),
        ...(data.body            !== undefined && { body:           data.body }),
        ...(data.asset_url       !== undefined && { assetUrl:       data.asset_url }),
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
        ...(data.answer_match_type !== undefined && {
          answerMatchType: JSON.stringify(data.answer_match_type),
        }),
        ...(data.correct_action       !== undefined && { correctAction:      data.correct_action }),
        ...(data.correct_text         !== undefined && { correctText:        data.correct_text }),
        ...(data.incorrect_text       !== undefined && { incorrectText:         data.incorrect_text }),
        ...(data.incorrect_quick_replies !== undefined && {
          incorrectQuickReplies: data.incorrect_quick_replies ? JSON.stringify(data.incorrect_quick_replies) : null,
        }),
        ...(data.correct_next_phase_id !== undefined && { correctNextPhaseId: data.correct_next_phase_id }),
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

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) {
      const details = formatZodErrors(err);
      console.error(`[PATCH /api/messages/${params.id}] ZodError:`, JSON.stringify(details, null, 2));
      return badRequest("入力値が不正です", details);
    }
    return serverError(err);
  }
});

// ── DELETE /api/messages/:id ─────────────────────
export const DELETE = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.message.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("メッセージ");

    const check = await requireRole(existing.work.oaId, user.id, 'owner');
    if (!check.ok) return check.response;

    await prisma.message.delete({ where: { id: params.id } });

    // キャッシュ無効化
    if (existing.phaseId) {
      await activeCache.delete(CACHE_KEY.phase(existing.phaseId));
      // kind="start" メッセージの削除は startMsgs キャッシュも無効化する
      await activeCache.delete(CACHE_KEY.startMsgs(existing.phaseId));
    } else {
      await activeCache.delete(CACHE_KEY.globalKw(existing.workId));
    }

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
