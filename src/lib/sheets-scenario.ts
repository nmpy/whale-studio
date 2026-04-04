// src/lib/sheets-scenario.ts
// Google Sheets モードの Webhook ハンドラ
//
// UserProgress の読み書きは引き続き Prisma (SQLite) を使用する。
// シナリオデータ（Work / Phase / Message / Transition / Character）は SheetsData から取得する。

import { prisma } from "./prisma";
import {
  replyToLine, buildPhaseMessages, buildQuickReply,
  isStartCommand, isResetCommand, isContinueCommand,
  RICHMENU_ACTIONS,
  type LineSender, type LineMessage,
} from "./line";
import {
  matchTransition, applySetFlags, safeParseFlags,
} from "./runtime";
import { linkRichMenuToUser } from "./line-richmenu";
import {
  type SheetsData,
  type SheetsWorkRow,
  type SheetsPhaseRow,
  findStartPhase,
  findPhaseById,
  findActiveMessages,
  findActiveTransitions,
  findCharacterById,
  findActiveWelcomeMessages,
  matchesStartKeyword,
} from "./sheets-db";
import type { RuntimeState, RuntimePhase, RuntimePhaseMessage, RuntimeTransition, PhaseType, MessageType, IconType } from "@/types";

// ─────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────

type OaRecord = {
  id: string;
  channelAccessToken: string;
};

type SheetsHandlerCommon = {
  oa:           OaRecord;
  data:         SheetsData;
  work:         SheetsWorkRow | null;
  systemSender: LineSender | undefined;
  userId:       string;
  replyToken:   string;
};

// ─────────────────────────────────────────────
// ランタイム状態構築（Sheets データから RuntimePhase を組み立てる）
// ─────────────────────────────────────────────

function buildRuntimePhaseFromSheets(
  data:    SheetsData,
  phase:   SheetsPhaseRow,
): RuntimePhase {
  const messages = findActiveMessages(data, phase.phase_id);
  const transitions = findActiveTransitions(data, phase.phase_id);

  const runtimeMessages: RuntimePhaseMessage[] = messages.map((msg) => {
    const char = msg.character_id ? findCharacterById(data, msg.character_id) : null;
    return {
      id:                msg.message_id,
      message_type:      msg.message_type as MessageType,
      body:              msg.body,
      asset_url:         msg.asset_url,
      alt_text:          null,
      flex_payload_json: null,
      quick_replies:     null,
      lag_ms:            0,
      hint_mode:         "always" as import("@/types").HintMode,
      sort_order:        msg.sort_order,
      character:    char
        ? {
            id:             char.character_id,
            name:           char.display_name,
            icon_type:      "image" as IconType,
            icon_text:      null,
            icon_color:     null,
            icon_image_url: char.icon_url ?? null,
          }
        : null,
    };
  });

  const runtimeTransitions: RuntimeTransition[] = transitions.map((tr) => {
    const toPhase = findPhaseById(data, tr.to_phase_id);
    return {
      id:         tr.transition_id,
      label:      tr.label,
      condition:  tr.condition,
      set_flags:  tr.set_flags,
      sort_order: tr.sort_order,
      to_phase: {
        id:         tr.to_phase_id,
        name:       toPhase?.name ?? tr.to_phase_id,
        phase_type: (toPhase?.phase_type ?? "normal") as PhaseType,
      },
    };
  });

  return {
    id:          phase.phase_id,
    phase_type:  phase.phase_type as PhaseType,
    name:        phase.name,
    description: phase.description,
    messages:    runtimeMessages,
    transitions: phase.phase_type === "ending" ? null : runtimeTransitions,
  };
}

type ProgressRecord = {
  id: string;
  lineUserId: string;
  workId: string;
  currentPhaseId: string | null;
  reachedEnding: boolean;
  flags: string;
  lastInteractedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

async function buildRuntimeStateFromSheets(
  data:     SheetsData,
  progress: ProgressRecord,
): Promise<RuntimeState> {
  const progressOut = {
    id:                 progress.id,
    line_user_id:       progress.lineUserId,
    work_id:            progress.workId,
    current_phase_id:   progress.currentPhaseId,
    reached_ending:     progress.reachedEnding,
    flags:              safeParseFlags(progress.flags),
    last_interacted_at: progress.lastInteractedAt.toISOString(),
    created_at:         progress.createdAt.toISOString(),
    updated_at:         progress.updatedAt.toISOString(),
  };

  if (!progress.currentPhaseId) {
    return { progress: progressOut, phase: null };
  }

  const phase = findPhaseById(data, progress.currentPhaseId);
  if (!phase) {
    return { progress: progressOut, phase: null };
  }

  return {
    progress: progressOut,
    phase:    buildRuntimePhaseFromSheets(data, phase),
  };
}

// ─────────────────────────────────────────────
// システムセンダー取得
// ─────────────────────────────────────────────

export function buildSystemSenderFromSheets(
  data: SheetsData,
  work: SheetsWorkRow,
): LineSender | undefined {
  if (!work.system_character_id) return undefined;
  const char = findCharacterById(data, work.system_character_id);
  if (!char) return undefined;
  return {
    name: char.display_name.slice(0, 20),
    ...(char.icon_url?.startsWith("https://") ? { iconUrl: char.icon_url } : {}),
  };
}

// ─────────────────────────────────────────────
// あいさつメッセージ
// ─────────────────────────────────────────────

function buildWelcomeMessagesFromSheets(
  data:         SheetsData,
  work:         SheetsWorkRow,
  systemSender: LineSender | undefined,
): LineMessage[] {
  const welcomeRows = findActiveWelcomeMessages(data, work.work_id);

  if (welcomeRows.length > 0) {
    // WelcomeMessages シートのメッセージを順番に送信
    const msgs: LineMessage[] = welcomeRows.map((wm) => {
      const char = wm.character_id ? findCharacterById(data, wm.character_id) : null;
      const sender: LineSender | undefined = char
        ? {
            name: char.display_name.slice(0, 20),
            ...(char.icon_url?.startsWith("https://") ? { iconUrl: char.icon_url } : {}),
          }
        : systemSender;

      // クイックリプライラベル（最後のメッセージにのみ付ける）
      const isLast = wm === welcomeRows[welcomeRows.length - 1];
      const qrLabels = isLast && wm.quick_reply_labels
        ? wm.quick_reply_labels.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      return {
        type:       "text" as const,
        text:       wm.body,
        sender,
        ...(qrLabels.length > 0 ? { quickReply: buildQuickReply(qrLabels) } : {}),
      };
    });
    return msgs;
  }

  // WelcomeMessages シートにない → work.welcome_message にフォールバック
  const hint = `「はじめる」と送ってください。`;
  if (work.welcome_message?.trim()) {
    return [
      { type: "text", text: work.welcome_message.trim(), sender: systemSender },
      { type: "text", text: hint,                        sender: systemSender },
    ];
  }
  return [{
    type:   "text",
    text:   `「${work.title}」へようこそ。\n準備ができたら「はじめる」と送ってください。`,
    sender: systemSender,
  }];
}

// ─────────────────────────────────────────────
// リッチメニュー切り替え
// ─────────────────────────────────────────────

const PHASE_TYPE_TO_VISIBLE: Record<string, string[]> = {
  start:   ["start"],
  normal:  ["playing"],
  ending:  ["cleared"],
};

async function switchRichMenuForUser(
  oa:        OaRecord,
  userId:    string,
  phaseType: string,
): Promise<void> {
  try {
    const visiblePhases = PHASE_TYPE_TO_VISIBLE[phaseType] ?? ["playing"];
    const menu = await prisma.richMenu.findFirst({
      where: {
        oaId:           oa.id,
        visiblePhase:   { in: visiblePhases },
        lineRichMenuId: { not: null },
        isActive:       true,
      },
    });
    if (menu?.lineRichMenuId) {
      await linkRichMenuToUser(oa.channelAccessToken, userId, menu.lineRichMenuId);
    }
  } catch (e) {
    console.warn("[sheets-scenario] richMenu 切り替え失敗:", e);
  }
}

// ─────────────────────────────────────────────
// isStart コマンド（スプレッドシートの start_keywords も考慮）
// ─────────────────────────────────────────────

function isStartCommandSheets(text: string, work: SheetsWorkRow | null): boolean {
  if (isStartCommand(text)) return true;
  if (work && matchesStartKeyword(work, text)) return true;
  return false;
}

// ─────────────────────────────────────────────
// ハンドラ実装
// ─────────────────────────────────────────────

export async function handleTextEventSheets({
  oa, data, work, systemSender, userId, text, replyToken,
}: SheetsHandlerCommon & { text: string }): Promise<void> {
  const token = oa.channelAccessToken;

  if (!work) {
    await replyToLine(replyToken, [{
      type: "text",
      text: "現在、公開中のシナリオはありません。もうしばらくお待ちください。",
    }], token);
    return;
  }

  if (isStartCommandSheets(text, work) || isResetCommand(text)) {
    await handleStartSheets({ oa, data, work, systemSender, userId, replyToken });
    return;
  }

  if (isContinueCommand(text)) {
    await handleContinueSheets({ oa, data, work, systemSender, userId, replyToken });
    return;
  }

  const progress = await prisma.userProgress.findUnique({
    where: { lineUserId_workId: { lineUserId: userId, workId: work.work_id } },
  });

  if (!progress) {
    await replyToLine(replyToken, buildWelcomeMessagesFromSheets(data, work, systemSender), token);
    return;
  }

  // エンディング到達済み → 自動返信なし（シナリオ定義に委ねる）
  if (progress.reachedEnding) {
    return;
  }

  if (!progress.currentPhaseId) {
    await replyToLine(replyToken, [{
      type: "text", text: "「はじめる」と送ってシナリオをスタートしてください。", sender: systemSender,
    }], token);
    return;
  }

  const currentPhaseRow = findPhaseById(data, progress.currentPhaseId);
  if (!currentPhaseRow) {
    await replyToLine(replyToken, [{
      type: "text", text: "「はじめる」と送ってシナリオをスタートしてください。", sender: systemSender,
    }], token);
    return;
  }

  const currentTransitions = findActiveTransitions(data, progress.currentPhaseId);
  const currentFlags = safeParseFlags(progress.flags);

  // matchTransition に渡すために camelCase の型に変換
  const transitionsForMatch = currentTransitions.map((t) => ({
    id:            t.transition_id,
    label:         t.label,
    condition:     t.condition,
    flagCondition: t.flag_condition,
    setFlags:      t.set_flags,
    isActive:      t.is_active,
  }));

  const matched = matchTransition(transitionsForMatch, { label: text, flags: currentFlags });

  // マッチなし → 無視（制作者定義の fallback に委ねる）
  if (!matched) {
    return;
  }

  // matched.id = transition_id から元の行を取得
  const matchedTransitionRow = currentTransitions.find((t) => t.transition_id === matched.id);
  if (!matchedTransitionRow) return;

  const toPhaseRow = findPhaseById(data, matchedTransitionRow.to_phase_id);
  if (!toPhaseRow) return;

  const isEnding = toPhaseRow.phase_type === "ending";
  const newFlags  = applySetFlags(currentFlags, matchedTransitionRow.set_flags);

  const updated = await prisma.userProgress.update({
    where: { id: progress.id },
    data: {
      currentPhaseId:   toPhaseRow.phase_id,
      reachedEnding:    isEnding,
      flags:            JSON.stringify(newFlags),
      lastInteractedAt: new Date(),
    },
  });

  const state = await buildRuntimeStateFromSheets(data, updated);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  await replyToLine(replyToken, msgs, token);

  // リッチメニュー切り替えは返信後にバックグラウンド実行（体感速度に影響しない）
  void switchRichMenuForUser(oa, userId, toPhaseRow.phase_type);
}

export async function handlePostbackEventSheets({
  oa, data, work, systemSender, userId, postbackData, replyToken,
}: SheetsHandlerCommon & { postbackData: string }): Promise<void> {
  switch (postbackData) {
    case RICHMENU_ACTIONS.START:
    case RICHMENU_ACTIONS.RESET:
      if (!work) {
        await replyToLine(replyToken, [{
          type: "text", text: "現在、公開中のシナリオはありません。しばらくお待ちください。", sender: systemSender,
        }], oa.channelAccessToken);
        return;
      }
      await handleStartSheets({ oa, data, work, systemSender, userId, replyToken });
      break;
    case RICHMENU_ACTIONS.CONTINUE:
      await handleContinueSheets({ oa, data, work, systemSender, userId, replyToken });
      break;
    default:
      // カスタム postback: 遷移ラベルとして処理
      if (work) {
        await handleTextEventSheets({
          oa, data, work, systemSender, userId, replyToken,
          text: postbackData,
        });
      } else {
        console.info(`[sheets-scenario] 未知の postback: "${postbackData}"`);
      }
  }
}

async function handleStartSheets({
  oa, data, work, systemSender, userId, replyToken,
}: Omit<SheetsHandlerCommon, "work"> & { work: SheetsWorkRow }): Promise<void> {
  const token = oa.channelAccessToken;

  const startPhase = findStartPhase(data, work.work_id);
  if (!startPhase) {
    await replyToLine(replyToken, [{
      type: "text", text: "まだシナリオの準備中です。もうしばらくお待ちください。", sender: systemSender,
    }], token);
    return;
  }

  const progress = await prisma.userProgress.upsert({
    where:  { lineUserId_workId: { lineUserId: userId, workId: work.work_id } },
    create: { lineUserId: userId, workId: work.work_id, currentPhaseId: startPhase.phase_id, reachedEnding: false, flags: "{}", lastInteractedAt: new Date() },
    update: { currentPhaseId: startPhase.phase_id, reachedEnding: false, flags: "{}", lastInteractedAt: new Date() },
  });

  const state = await buildRuntimeStateFromSheets(data, progress);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  await replyToLine(replyToken, msgs, token);

  // リッチメニュー切り替えは返信後にバックグラウンド実行
  void switchRichMenuForUser(oa, userId, startPhase.phase_type);
}

async function handleContinueSheets({
  oa, data, work, systemSender, userId, replyToken,
}: SheetsHandlerCommon): Promise<void> {
  const token = oa.channelAccessToken;

  if (!work) {
    await replyToLine(replyToken, [{
      type: "text", text: "現在、公開中のシナリオはありません。しばらくお待ちください。", sender: systemSender,
    }], token);
    return;
  }

  const progress = await prisma.userProgress.findUnique({
    where: { lineUserId_workId: { lineUserId: userId, workId: work.work_id } },
  });

  if (!progress) {
    await replyToLine(replyToken, buildWelcomeMessagesFromSheets(data, work, systemSender), token);
    return;
  }

  // エンディング到達済み → 自動返信なし（シナリオ定義に委ねる）
  if (progress.reachedEnding) {
    return;
  }

  const state = await buildRuntimeStateFromSheets(data, progress);
  const msgs  = buildPhaseMessages(state.phase, { systemSender });
  await replyToLine(replyToken, msgs, token);
}
