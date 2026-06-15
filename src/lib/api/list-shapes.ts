// src/lib/api/list-shapes.ts
//
// 管理画面の一覧系 API（messages / phases / transitions）が返す snake_case レスポンスへの
// 整形関数を集約する。
//
// 背景:
//   従来は各 route.ts (= /api/messages, /api/phases, /api/transitions) に同名の
//   `toResponse` が定義されていた。メッセージ一覧の初期表示を 1 本にまとめる
//   Bootstrap API (= /api/oas/[id]/works/[workId]/messages/bootstrap) でも同じ整形が
//   必要になったため、shape を単一の source of truth に集約して drift を防ぐ。
//
//   Next.js の route.ts は HTTP メソッド以外の named export を許さない
//   (= 型チェックで `{ [x:string]: never }` 制約に反する) ため、route 間で関数を
//   共有するにはこの lib に切り出すのが正攻法。
//
// 出力 shape は従来の各 route の `toResponse` と完全に同一（フィールド・型・既定値とも不変）。

import { parseAnswerMatchType, parsePuzzleAnswers } from "@/lib/puzzle-answer";

// ── messages ────────────────────────────────────────────────

export function parseQuickReplies(raw: string | null, msgId?: string) {
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

export function messageToResponse(m: {
  id: string; workId: string; phaseId: string | null; characterId: string | null;
  messageType: string; kind: string; body: string | null; assetUrl: string | null;
  triggerKeyword: string | null; targetSegment: string | null;
  notifyText: string | null; riddleId: string | null;
  quickReplies: string | null; nextMessageId?: string | null;
  altText?: string | null; flexPayloadJson?: string | null;
  puzzleType?: string | null; answer?: string | null; answers?: string | null; puzzleHintText?: string | null;
  answerMatchType?: string | null; correctAction?: string | null;
  correctText?: string | null; correctCharacterId?: string | null;
  incorrectText?: string | null; incorrectCharacterId?: string | null;
  incorrectQuickReplies?: string | null;
  correctNextPhaseId?: string | null;
  hintMode?: string;
  lagMs?: number;
  // 演出設定
  readReceiptMode?: string | null;
  readDelayMs?: number | null;
  typingEnabled?: boolean | null;
  typingMinMs?: number | null;
  typingMaxMs?: number | null;
  loadingEnabled?: boolean | null;
  loadingThresholdMs?: number | null;
  loadingMinSeconds?: number | null;
  loadingMaxSeconds?: number | null;
  // タップ遷移先
  tapDestinationId?: string | null;
  tapUrl?: string | null;
  // 画像タップ時アクション
  imageActionType?: string | null;
  imageActionText?: string | null;
  imageActionUrl?: string | null;
  imageActionLiffPageId?: string | null;
  imageActionPostbackData?: string | null;
  // 自由入力受付（このメッセージ送信後にユーザーの次入力を保存する）
  freeInputEnabled?: boolean;
  freeInputVariableKey?: string | null;
  freeInputNextMessageId?: string | null;
  // 送信後の待機トリガー（地点到着で自動進行）。一覧ではチェーン継続判定・フェーズ完了条件の見える化に使う。
  checkinTriggerType?: string | null;
  checkinTriggerLocationId?: string | null;
  checkinTriggerNextMessageId?: string | null;
  checkinTriggerNextPhaseId?: string | null;
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
    answers:              parsePuzzleAnswers(m.answers ?? null),
    puzzle_hint_text:     m.puzzleHintText ?? null,
    answer_match_type:    parseAnswerMatchType(m.answerMatchType ?? null),
    correct_action:       m.correctAction ?? null,
    correct_text:         m.correctText ?? null,
    correct_character_id:    m.correctCharacterId ?? null,
    incorrect_text:          m.incorrectText ?? null,
    incorrect_character_id:  m.incorrectCharacterId ?? null,
    incorrect_quick_replies: parseQuickReplies(m.incorrectQuickReplies ?? null, m.id),
    correct_next_phase_id:   m.correctNextPhaseId ?? null,
    hint_mode:            (m.hintMode ?? "always") as import("@/types").HintMode,
    lag_ms:               m.lagMs ?? 0,
    // 演出設定
    read_receipt_mode:    (m.readReceiptMode as import("@/types").ReadReceiptMode) ?? null,
    read_delay_ms:        m.readDelayMs ?? null,
    typing_enabled:       m.typingEnabled ?? null,
    typing_min_ms:        m.typingMinMs ?? null,
    typing_max_ms:        m.typingMaxMs ?? null,
    loading_enabled:      m.loadingEnabled ?? null,
    loading_threshold_ms: m.loadingThresholdMs ?? null,
    loading_min_seconds:  m.loadingMinSeconds ?? null,
    loading_max_seconds:  m.loadingMaxSeconds ?? null,
    // タップ遷移先
    tap_destination_id:   m.tapDestinationId ?? null,
    tap_url:              m.tapUrl ?? null,
    // 画像タップ時アクション
    image_action_type:          m.imageActionType         ?? null,
    image_action_text:          m.imageActionText         ?? null,
    image_action_url:           m.imageActionUrl          ?? null,
    image_action_liff_page_id:  m.imageActionLiffPageId   ?? null,
    image_action_postback_data: m.imageActionPostbackData ?? null,
    // 自由入力受付
    free_input_enabled:         m.freeInputEnabled         ?? false,
    free_input_variable_key:    m.freeInputVariableKey     ?? null,
    free_input_next_message_id: m.freeInputNextMessageId   ?? null,
    // 送信後の待機トリガー（地点到着で自動進行）
    checkin_trigger_type:            m.checkinTriggerType          ?? null,
    checkin_trigger_location_id:     m.checkinTriggerLocationId    ?? null,
    checkin_trigger_next_message_id: m.checkinTriggerNextMessageId ?? null,
    checkin_trigger_next_phase_id:   m.checkinTriggerNextPhaseId   ?? null,
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

// ── phases ──────────────────────────────────────────────────

export function phaseToResponse(p: {
  id: string; workId: string; phaseType: string; name: string; description: string | null;
  startTrigger: string | null; resumeSummary: string | null;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  _count?: { messages: number; transitionsFrom: number };
}) {
  return {
    id:             p.id,
    work_id:        p.workId,
    phase_type:     p.phaseType,
    name:           p.name,
    description:    p.description,
    start_trigger:  p.startTrigger,
    resume_summary: p.resumeSummary,
    sort_order:     p.sortOrder,
    is_active:      p.isActive,
    created_at:     p.createdAt,
    updated_at:     p.updatedAt,
    ...(p._count !== undefined && { _count: p._count }),
  };
}

// ── transitions ─────────────────────────────────────────────

export function transitionToResponse(
  t: {
    id: string; workId: string; fromPhaseId: string; toPhaseId: string;
    label: string; condition: string | null;
    flagCondition: string | null; setFlags: string;
    sortOrder: number; isActive: boolean;
    createdAt: Date; updatedAt: Date;
  },
  toPhase?: { id: string; name: string; phaseType: string } | null,
) {
  return {
    id:             t.id,
    work_id:        t.workId,
    from_phase_id:  t.fromPhaseId,
    to_phase_id:    t.toPhaseId,
    label:          t.label,
    condition:      t.condition,
    flag_condition: t.flagCondition,
    set_flags:      t.setFlags,
    sort_order:     t.sortOrder,
    is_active:      t.isActive,
    created_at:     t.createdAt,
    updated_at:     t.updatedAt,
    ...(toPhase !== undefined && {
      to_phase: toPhase
        ? { id: toPhase.id, name: toPhase.name, phase_type: toPhase.phaseType }
        : null,
    }),
  };
}
