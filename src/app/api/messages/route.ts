// src/app/api/messages/route.ts
// GET  /api/messages?work_id=xxx — メッセージ一覧取得
// POST /api/messages               — メッセージ作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createMessageSchema, messageQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

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

function toResponse(m: {
  id: string; workId: string; phaseId: string | null; characterId: string | null;
  messageType: string; kind: string; body: string | null; assetUrl: string | null;
  triggerKeyword: string | null; targetSegment: string | null;
  notifyText: string | null; riddleId: string | null;
  quickReplies: string | null; nextMessageId?: string | null;
  altText?: string | null; flexPayloadJson?: string | null;
  puzzleType?: string | null; answer?: string | null; puzzleHintText?: string | null;
  answerMatchType?: string | null; correctAction?: string | null;
  correctText?: string | null; incorrectText?: string | null;
  correctNextPhaseId?: string | null;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  phase?: { id: string; name: string; phaseType: string } | null;
  character?: { id: string; name: string; iconType: string; iconText: string | null; iconImageUrl: string | null; iconColor: string | null } | null;
}) {
  return {
    id:                   m.id,
    work_id:              m.workId,
    phase_id:             m.phaseId,
    character_id:         m.characterId,
    message_type:         m.messageType,
    kind:                 m.kind,
    body:                 m.body,
    asset_url:            m.assetUrl,
    trigger_keyword:      m.triggerKeyword,
    target_segment:       m.targetSegment,
    notify_text:          m.notifyText,
    riddle_id:            m.riddleId,
    quick_replies:        parseQuickReplies(m.quickReplies, m.id),
    next_message_id:      m.nextMessageId ?? null,
    alt_text:             m.altText ?? null,
    flex_payload_json:    m.flexPayloadJson ?? null,
    puzzle_type:          m.puzzleType ?? null,
    answer:               m.answer ?? null,
    puzzle_hint_text:     m.puzzleHintText ?? null,
    answer_match_type:    parseAnswerMatchType(m.answerMatchType ?? null),
    correct_action:       m.correctAction ?? null,
    correct_text:         m.correctText ?? null,
    incorrect_text:       m.incorrectText ?? null,
    correct_next_phase_id: m.correctNextPhaseId ?? null,
    sort_order:           m.sortOrder,
    is_active:            m.isActive,
    created_at:           m.createdAt,
    updated_at:           m.updatedAt,
    ...(m.phase     !== undefined && {
      phase: m.phase ? { id: m.phase.id, name: m.phase.name, phase_type: m.phase.phaseType } : null,
    }),
    ...(m.character !== undefined && {
      character: m.character ? {
        id:             m.character.id,
        name:           m.character.name,
        icon_type:      m.character.iconType,
        icon_text:      m.character.iconText,
        icon_image_url: m.character.iconImageUrl,
        icon_color:     m.character.iconColor,
      } : null,
    }),
  };
}

// ── GET /api/messages ────────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
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

    const work = await prisma.work.findUnique({ where: { id: query.work_id } });
    if (!work) return notFound("作品");

    const oaId = await getOaIdFromWorkId(query.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'viewer');
      if (!check.ok) return check.response;
    }

    const messages = await prisma.message.findMany({
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
    });

    return ok(messages.map(toResponse));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/messages ───────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    console.log("[POST /api/messages] raw body:", JSON.stringify(body, null, 2));
    const data = createMessageSchema.parse(body);

    // Work 存在確認
    const work = await prisma.work.findUnique({ where: { id: data.work_id } });
    if (!work) return notFound("作品");

    const oaId = await getOaIdFromWorkId(data.work_id);
    if (oaId) {
      const check = await requireRole(oaId, user.id, 'editor');
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
        answerMatchType:    data.answer_match_type ? JSON.stringify(data.answer_match_type) : JSON.stringify(["exact"]),
        correctAction:      data.correct_action      ?? null,
        correctText:        data.correct_text        ?? null,
        incorrectText:      data.incorrect_text      ?? null,
        correctNextPhaseId: data.correct_next_phase_id ?? null,
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
      await activeCache.delete(CACHE_KEY.phase(data.phase_id));
      // kind="start" メッセージの追加は startMsgs キャッシュも無効化する
      await activeCache.delete(CACHE_KEY.startMsgs(data.phase_id));
    } else {
      await activeCache.delete(CACHE_KEY.globalKw(data.work_id));
    }

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
