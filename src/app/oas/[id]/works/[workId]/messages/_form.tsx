// src/app/oas/[id]/works/[workId]/messages/_form.tsx
// 共有メッセージフォーム（新規・編集ページで使用）

"use client";
import DurationInput from "@/components/DurationInput";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { phaseApi, characterApi, riddleApi, messageApi, uploadApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PhaseWithCounts, Character, QuickReplyItem, QuickReplyAction, ReadReceiptMode } from "@/types";
import type { Riddle } from "@/types";
import { PhaseTransitionsSection } from "./_phase-transitions";
import { previewQrSend, type QrPreviewMessage } from "./_qr-preview";
import { previewChainSend } from "./_chain-send-preview";
import { moveSlot, insertSlotAt, appendSlot, canMove, canInsertAt, hasFreeInputSlot, appendIndex } from "./_chain-reorder";
import { ImportPicker } from "./_import-picker";
import { toImportMessage, insertImportedSlots } from "./_chain-import";
import { nextTransitionDisabledByPuzzle } from "@/lib/message-flow";
import { TapDestinationSection } from "@/components/destination/TapDestinationSection";
import type { TapMode } from "@/components/destination/TapDestinationSection";
import { detectTapMode } from "@/lib/message-destination-utils";
import { destinationApi } from "@/lib/api-client";
import type { LineDestination } from "@/types";
import { normalizeFlexJson, prettyFlexJson, FLEX_SIMULATOR_URL, FLEX_ERRORS } from "@/lib/flex";

// ── 拡張メッセージ種別 ────────────────────────────────────

export type ExtendedMessageType =
  | "text"
  | "image"
  | "riddle"
  | "video"
  | "carousel"
  | "voice"
  | "flex";

// ── 定数 ────────────────────────────────────────────────

export const MESSAGE_TYPE_OPTIONS: {
  value: ExtendedMessageType;
  label: string;
  desc: string;
}[] = [
  { value: "text",     label: "テキスト",     desc: "テキストメッセージ" },
  { value: "image",    label: "画像",         desc: "画像メッセージ" },
  { value: "video",    label: "動画",         desc: "動画メッセージ" },
  { value: "carousel", label: "カルーセル",   desc: "カルーセルメッセージ" },
  { value: "voice",    label: "ボイス",       desc: "ボイスメッセージ" },
  { value: "flex",     label: "Flex Message", desc: "LINE公式のFlex Message Simulatorで作成したJSONを貼り付けて送信できます。" },
];

/** 謎の配信形式セレクター用（riddle / voice / flex は謎では使用しない） */
const PUZZLE_DELIVERY_TYPE_OPTIONS = MESSAGE_TYPE_OPTIONS.filter(
  (opt) => ["text", "image", "video", "carousel"].includes(opt.value)
);

/** Flex Message JSON textarea のプレースホルダ（Simulator の最小 bubble 例）。 */
const FLEX_JSON_PLACEHOLDER = `{
  "type": "bubble",
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      {
        "type": "text",
        "text": "Hello, Flex Message!"
      }
    ]
  }
}`;

/** 「サンプルを挿入」で textarea に入れる最小構成 bubble。 */
const FLEX_SAMPLE_JSON = `{
  "type": "bubble",
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      {
        "type": "text",
        "text": "Hello, Flex Message!",
        "weight": "bold",
        "size": "lg"
      }
    ]
  }
}`;

// ── カルーセルカード型 ────────────────────────────────────

export interface MessageCarouselCard {
  image_url:       string;
  title:           string;
  body:            string;
  button_label:    string;
  button_url:      string;
  /** destination を使用する場合の ID（null = 直接URL） */
  destination_id?: string | null;
}

const EMPTY_CAROUSEL_CARD: MessageCarouselCard = {
  image_url:    "",
  title:        "",
  body:         "",
  button_label: "",
  button_url:   "",
};

// ── 追加メッセージスロット型 ──────────────────────────────
// 型 / EMPTY 値 / pure helper は _form-helpers.ts に切り出し済 (= vitest が
// bracket route パスの .tsx 解析でエラーになるため)。本ファイルは re-export で API 維持。

export {
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  EMPTY_ADDITIONAL_SLOT,
} from "./_form-helpers";
export type { AdditionalMessageSlot } from "./_form-helpers";

import {
  EMPTY_ADDITIONAL_SLOT as _EMPTY_ADDITIONAL_SLOT,
  type AdditionalMessageSlot as _AdditionalMessageSlot,
} from "./_form-helpers";
// 内部参照用エイリアス (= 既存コードの local シンボル名と互換)
const EMPTY_ADDITIONAL_SLOT = _EMPTY_ADDITIONAL_SLOT;
type AdditionalMessageSlot = _AdditionalMessageSlot;

// ── FormState ────────────────────────────────────────────

export type MessageKind = "start" | "normal" | "response" | "hint" | "puzzle" | "global" | "system_notice";
export type AnswerMatchType = "exact" | "partial" | "ignore_punctuation" | "normalize_width";
export type AnswerMatchMode = "exact" | "partial";
export type CorrectAction   = "text" | "text_and_transition" | "transition";

export interface MessageFormState {
  trigger_keyword: string;
  target_segment:  string;
  phase_id:        string;
  character_id:    string;
  message_type:    ExtendedMessageType;
  /** メッセージ役割種別 */
  kind:            MessageKind;
  body:            string;
  asset_url:       string;
  notify_text:     string;
  riddle_id:       string;
  carousel_items:  MessageCarouselCard[];
  quick_replies:   QuickReplyItem[];
  /** 連続送信チェーン先メッセージ ID（空文字 = チェーンなし） */
  next_message_id: string;
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = 即時送信 */
  lag_ms:          number;
  // ── 自由入力受付 ──
  /** このメッセージ送信後、次のテキスト入力を変数として保存するか。 */
  free_input_enabled:         boolean;
  /** 保存先の変数名 (例: "userName")。半角英数字 + `_`、先頭は英字 or `_`。 */
  free_input_variable_key:    string;
  /** 自由入力を受け取った後に進む次メッセージ ID (空文字 = なし)。 */
  free_input_next_message_id: string;
  sort_order:      number;
  is_active:       boolean;
  // ── 謎（puzzle）専用フィールド ──
  puzzle_type:           string;
  answer:                string;
  puzzle_hint_text:      string;
  hint_mode:             "always" | "on_wrong" | "hidden";
  answer_match_type:     AnswerMatchType[];
  correct_action:        CorrectAction;
  correct_text:          string;
  incorrect_text:           string;
  incorrect_quick_replies:  QuickReplyItem[];
  correct_next_phase_id:    string;
  /** 2通目以降のメッセージ（チェーン送信） */
  additionalMessages: AdditionalMessageSlot[];
  /** chain から外した既存メッセージ id（実体は残し保存時 nextMessageId=null・#6-4c）。 */
  detachedMessageIds?: string[];
  // ── タップ遷移先 ──
  tap_destination_id:  string; // "" = 未設定
  tap_url:             string; // "" = 未設定
  // ── 画像タップ時アクション (message_type="image" 用) ──
  /** "" = なし。"message" | "uri" | "liff" | "postback" */
  image_action_type:          "" | "message" | "uri" | "liff" | "postback";
  image_action_text:          string;
  image_action_url:           string;
  image_action_liff_page_id:  string;
  image_action_postback_data: string;
  alt_text:                   string;
  // ── Flex Message (message_type="flex" 用) ──
  /** 貼り付け JSON (bubble/carousel または flex 全体)。編集時は整形済みで復元する。 */
  flex_payload_json:          string;
  // ── 演出設定 ──
  // 継承モード廃止。read_receipt_mode は常に "immediate" / "delayed" / "before_reply"
  // のいずれか。typing_enabled / loading_enabled は "true" / "false" のいずれか。
  // 数値フィールド (read_delay_ms 等) は空文字 = 未指定 (= runtime の固定デフォルトを使用)。
  read_receipt_mode:    string; // "immediate" (OFF) | "delayed" | "before_reply"
  read_delay_ms:        string; // 数値入力 / 空文字 = デフォルト
  typing_enabled:       string; // "true" | "false"
  typing_min_ms:        string;
  typing_max_ms:        string;
  loading_enabled:      string; // "true" | "false"
  loading_threshold_ms: string;
  loading_min_seconds:  string;
  loading_max_seconds:  string;
}

export const EMPTY_MESSAGE_FORM: MessageFormState = {
  trigger_keyword: "",
  target_segment:  "",
  phase_id:        "",
  character_id:    "",
  message_type:    "text",
  kind:            "normal",
  body:            "",
  asset_url:       "",
  notify_text:     "",
  riddle_id:       "",
  carousel_items:  [],
  quick_replies:   [],
  next_message_id: "",
  lag_ms:          0,
  // 自由入力受付（既定 OFF）
  free_input_enabled:         false,
  free_input_variable_key:    "",
  free_input_next_message_id: "",
  sort_order:      0,
  is_active:       true,
  // puzzle defaults
  puzzle_type:           "",
  answer:                "",
  puzzle_hint_text:      "",
  hint_mode:             "always",
  answer_match_type:     ["exact"],
  correct_action:        "text",
  correct_text:          "",
  incorrect_text:          "",
  incorrect_quick_replies: [],
  correct_next_phase_id:   "",
  additionalMessages:      [],
  // タップ遷移先
  tap_destination_id:  "",
  tap_url:             "",
  // 画像タップ時アクション
  image_action_type:          "",
  image_action_text:          "",
  image_action_url:           "",
  image_action_liff_page_id:  "",
  image_action_postback_data: "",
  alt_text:                   "",
  flex_payload_json:          "",
  // 演出設定 (= 継承モード廃止: すべて OFF 相当を初期値とする)。
  read_receipt_mode:    "immediate", // = OFF (人為的な既読遅延なし)
  read_delay_ms:        "",
  typing_enabled:       "false",
  typing_min_ms:        "",
  typing_max_ms:        "",
  loading_enabled:      "false",
  loading_threshold_ms: "",
  loading_min_seconds:  "",
  loading_max_seconds:  "",
};

// ── コンバーター ──────────────────────────────────────────

export function msgToFormState(msg: {
  trigger_keyword?:      string | null;
  target_segment?:       string | null;
  phase_id?:             string | null;
  character_id?:         string | null;
  message_type?:         string;
  kind?:                 string | null;
  body?:                 string | null;
  asset_url?:            string | null;
  notify_text?:          string | null;
  riddle_id?:            string | null;
  quick_replies?:        QuickReplyItem[] | null;
  next_message_id?:      string | null;
  puzzle_type?:          string | null;
  answer?:               string | null;
  puzzle_hint_text?:     string | null;
  hint_mode?:            string | null;
  answer_match_type?:    string[] | null;
  correct_action?:       string | null;
  correct_text?:            string | null;
  incorrect_text?:          string | null;
  incorrect_quick_replies?: QuickReplyItem[] | null;
  correct_next_phase_id?:   string | null;
  lag_ms?:                  number | null;
  sort_order?:              number;
  is_active?:               boolean;
  phase?:                   { phase_type?: string | null } | null;
  // タップ遷移先
  tap_destination_id?:   string | null;
  tap_url?:              string | null;
  // 画像タップ時アクション
  image_action_type?:         string | null;
  image_action_text?:         string | null;
  image_action_url?:          string | null;
  image_action_liff_page_id?: string | null;
  image_action_postback_data?: string | null;
  alt_text?:                  string | null;
  flex_payload_json?:         string | null;
  // 自由入力受付
  free_input_enabled?:         boolean | null;
  free_input_variable_key?:    string | null;
  free_input_next_message_id?: string | null;
  // 演出設定
  read_receipt_mode?:    string | null;
  read_delay_ms?:        number | null;
  typing_enabled?:       boolean | null;
  typing_min_ms?:        number | null;
  typing_max_ms?:        number | null;
  loading_enabled?:      boolean | null;
  loading_threshold_ms?: number | null;
  loading_min_seconds?:  number | null;
  loading_max_seconds?:  number | null;
}): MessageFormState {
  // Parse carousel items from body JSON if message_type is carousel
  let carousel_items: MessageCarouselCard[] = [];
  if (msg.message_type === "carousel" && msg.body) {
    try {
      const parsed = JSON.parse(msg.body);
      if (Array.isArray(parsed)) carousel_items = parsed as MessageCarouselCard[];
    } catch {
      carousel_items = [];
    }
  }

  // kind="response" かつ phase_id=null またはグローバルフェーズの場合は UI上の "global" 種別として復元する
  const resolvedKind: MessageKind =
    msg.kind === "response" && (msg.phase_id === null || msg.phase_id === undefined || msg.phase?.phase_type === "global")
      ? "global"
      : (msg.kind as MessageKind) ?? "normal";

  return {
    trigger_keyword:       msg.trigger_keyword ?? "",
    target_segment:        msg.target_segment  ?? "",
    phase_id:              msg.phase_id        ?? "",
    character_id:          msg.character_id    ?? "",
    message_type:          (msg.message_type as ExtendedMessageType) ?? "text",
    kind:                  resolvedKind,
    body:                  msg.message_type === "carousel" ? "" : (msg.body ?? ""),
    asset_url:             msg.asset_url       ?? "",
    notify_text:           msg.notify_text     ?? "",
    riddle_id:             msg.riddle_id       ?? "",
    carousel_items,
    quick_replies:         msg.quick_replies   ?? [],
    next_message_id:       msg.next_message_id ?? "",
    lag_ms:                msg.lag_ms          ?? 0,
    sort_order:            msg.sort_order      ?? 0,
    is_active:             msg.is_active       ?? true,
    puzzle_type:           msg.puzzle_type     ?? "",
    answer:                msg.answer          ?? "",
    puzzle_hint_text:      msg.puzzle_hint_text ?? "",
    hint_mode: (msg.hint_mode as "always" | "on_wrong" | "hidden") ?? "always",
    answer_match_type:     (msg.answer_match_type ?? ["exact"]) as AnswerMatchType[],
    correct_action:        (msg.correct_action ?? "text") as CorrectAction,
    correct_text:            msg.correct_text    ?? "",
    incorrect_text:          msg.incorrect_text  ?? "",
    incorrect_quick_replies: msg.incorrect_quick_replies ?? [],
    correct_next_phase_id:   msg.correct_next_phase_id ?? "",
    additionalMessages:      [],
    // タップ遷移先
    tap_destination_id:  msg.tap_destination_id ?? "",
    tap_url:             msg.tap_url ?? "",
    // 画像タップ時アクション
    image_action_type:          ((msg.image_action_type === "message" || msg.image_action_type === "uri"
                                  || msg.image_action_type === "liff" || msg.image_action_type === "postback")
                                  ? msg.image_action_type : "") as "" | "message" | "uri" | "liff" | "postback",
    image_action_text:          msg.image_action_text         ?? "",
    image_action_url:           msg.image_action_url          ?? "",
    image_action_liff_page_id:  msg.image_action_liff_page_id ?? "",
    image_action_postback_data: msg.image_action_postback_data ?? "",
    alt_text:                   msg.alt_text                  ?? "",
    // Flex Message: 保存済み contents JSON を整形して textarea に復元
    flex_payload_json:          prettyFlexJson(msg.flex_payload_json),
    // 自由入力受付
    free_input_enabled:         msg.free_input_enabled         ?? false,
    free_input_variable_key:    msg.free_input_variable_key    ?? "",
    free_input_next_message_id: msg.free_input_next_message_id ?? "",
    // 演出設定 (= 継承モード廃止: null / 旧 "inherit" は OFF 相当に正規化)。
    // - read_receipt_mode: null / "inherit" → "immediate" (= OFF)
    // - typing_enabled / loading_enabled: null → "false" (= OFF)
    // - 数値フィールドは null → 空文字 (= 未指定。runtime の固定デフォルトを使用)
    read_receipt_mode:    (msg.read_receipt_mode === "delayed" || msg.read_receipt_mode === "before_reply")
                            ? msg.read_receipt_mode
                            : "immediate",
    read_delay_ms:        msg.read_delay_ms != null ? String(msg.read_delay_ms) : "",
    typing_enabled:       msg.typing_enabled === true ? "true" : "false",
    typing_min_ms:        msg.typing_min_ms != null ? String(msg.typing_min_ms) : "",
    typing_max_ms:        msg.typing_max_ms != null ? String(msg.typing_max_ms) : "",
    loading_enabled:      msg.loading_enabled === true ? "true" : "false",
    loading_threshold_ms: msg.loading_threshold_ms != null ? String(msg.loading_threshold_ms) : "",
    loading_min_seconds:  msg.loading_min_seconds != null ? String(msg.loading_min_seconds) : "",
    loading_max_seconds:  msg.loading_max_seconds != null ? String(msg.loading_max_seconds) : "",
  };
}

export function formStateToMsgBody(form: MessageFormState) {
  const isPuzzle  = form.kind === "puzzle";
  const isGlobal  = form.kind === "global";
  const isSystemNotice = form.kind === "system_notice";
  const payload = {
    // システム通知はキーワード入力待ちにしないため trigger_keyword を強制 null
    trigger_keyword:  isSystemNotice ? null : (form.trigger_keyword || null),
    target_segment:   form.target_segment  || null,
    // 共通メッセージはフェーズ不問のため phase_id を null にする
    phase_id:         isGlobal ? null : (form.phase_id || null),
    // システム通知は中央寄せ表示のため、話者キャラクターを持たない
    character_id:     isSystemNotice ? null : (form.character_id || null),
    // システム通知はテキストで送る前提なので message_type を強制 "text"
    message_type:     isSystemNotice ? "text" : form.message_type,
    // global は API に kind="response" + phase_id=null で送信
    kind:             (isGlobal ? "response" : form.kind) as Exclude<MessageKind, "global">,
    body:
      isSystemNotice
        ? form.body || undefined
        : form.message_type === "carousel"
        ? JSON.stringify(form.carousel_items)
        : form.message_type === "text"
        ? form.body || undefined
        // puzzle の image/video でも body を保持（LINE 送信時のフォールバックテキストとして使用）
        : isPuzzle
        ? form.body || form.notify_text || undefined
        : undefined,
    asset_url:         (!isSystemNotice && (form.message_type === "image" || form.message_type === "video" || form.message_type === "voice"))
      ? form.asset_url || undefined
      : undefined,
    notify_text:       (!isSystemNotice && form.message_type !== "text")
      ? form.notify_text || undefined
      : undefined,
    riddle_id:         !isPuzzle && !isSystemNotice ? (form.riddle_id || null) : null,
    quick_replies:     !isSystemNotice && form.quick_replies.length > 0 ? form.quick_replies : null,
    next_message_id:   form.next_message_id || null,
    lag_ms:            form.lag_ms,
    sort_order:        form.sort_order,
    is_active:         form.is_active,
    // puzzle fields
    puzzle_type:           isPuzzle ? (form.message_type as "text" | "image" | "video" | "carousel") || null : null,
    answer:                isPuzzle ? form.answer || null : null,
    puzzle_hint_text:      isPuzzle ? form.puzzle_hint_text || null : null,
    answer_match_type:     isPuzzle ? form.answer_match_type : ["exact"],
    correct_action:        isPuzzle ? form.correct_action || null : null,
    correct_text:          isPuzzle ? form.correct_text || null : null,
    incorrect_text:          isPuzzle ? form.incorrect_text || null : null,
    incorrect_quick_replies: isPuzzle && form.incorrect_quick_replies.length > 0 ? form.incorrect_quick_replies : null,
    correct_next_phase_id:   isPuzzle ? form.correct_next_phase_id || null : null,
    hint_mode: form.hint_mode,
    // タップ遷移先
    tap_destination_id: form.tap_destination_id || null,
    tap_url:            form.tap_url || null,
    // 画像タップ時アクション (画像メッセージのみ。type 空文字 = 無効)
    image_action_type:
      form.message_type === "image" && form.image_action_type
        ? (form.image_action_type as "message" | "uri" | "liff" | "postback")
        : null,
    image_action_text:
      form.message_type === "image" && form.image_action_type === "message"
        ? (form.image_action_text.trim() || null)
        : null,
    image_action_url:
      form.message_type === "image" && form.image_action_type === "uri"
        ? (form.image_action_url.trim() || null)
        : null,
    image_action_liff_page_id:
      form.message_type === "image" && form.image_action_type === "liff"
        ? (form.image_action_liff_page_id || null)
        : null,
    image_action_postback_data:
      form.message_type === "image" && form.image_action_type === "postback"
        ? (form.image_action_postback_data.trim() || null)
        : null,
    // alt_text (画像メッセージの Flex 変換 / Flex Message の代替テキストとして使用)
    alt_text:
      form.message_type === "image"
        ? (form.alt_text.trim() || null)
        : (form.alt_text.trim() || null),
    // Flex Message: 貼り付け JSON を contents (bubble/carousel) へ正規化して保存。
    // 不正な場合は raw を送り、サーバー側 Zod で同じ判定によりエラーにする（client 検証で通常はブロック済み）。
    flex_payload_json:
      form.message_type === "flex"
        ? (() => {
            const norm = normalizeFlexJson(form.flex_payload_json);
            return norm.ok ? JSON.stringify(norm.value.contents) : (form.flex_payload_json.trim() || null);
          })()
        : null,
    // 自由入力受付
    free_input_enabled:         !!form.free_input_enabled,
    // ON のときのみ key を保存。OFF のときは null にして整合性を保つ。
    free_input_variable_key:    form.free_input_enabled ? (form.free_input_variable_key.trim() || null) : null,
    free_input_next_message_id: form.free_input_enabled ? (form.free_input_next_message_id || null) : null,
    // 演出設定 (= 継承モード廃止により form は常に明示値 "immediate"/"true"/"false" 等を持つ)。
    // 数値フィールドは空文字なら null (= 未指定、runtime 固定デフォルト適用)。
    read_receipt_mode:    (form.read_receipt_mode || null) as ReadReceiptMode | null,
    read_delay_ms:        form.read_delay_ms ? Number(form.read_delay_ms) : null,
    typing_enabled:       form.typing_enabled === "true" ? true : false,
    typing_min_ms:        form.typing_min_ms ? Number(form.typing_min_ms) : null,
    typing_max_ms:        form.typing_max_ms ? Number(form.typing_max_ms) : null,
    loading_enabled:      form.loading_enabled === "true" ? true : false,
    loading_threshold_ms: form.loading_threshold_ms ? Number(form.loading_threshold_ms) : null,
    loading_min_seconds:  form.loading_min_seconds ? Number(form.loading_min_seconds) : null,
    loading_max_seconds:  form.loading_max_seconds ? Number(form.loading_max_seconds) : null,
  };
  console.log("[formStateToMsgBody] payload:", JSON.stringify(payload, null, 2));
  return payload;
}

// ── バリデーション ────────────────────────────────────────

export function validateMessageForm(form: MessageFormState): string | null {
  // ── 自由入力受付バリデーション (kind を問わず先に判定) ──
  // variable_key は任意 (空欄＝入力をどこにも保存しない / ログ用途)。
  // 値があるときだけ regex チェックする。
  if (form.free_input_enabled) {
    const key = form.free_input_variable_key.trim();
    if (key && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      return "変数名は半角英数字とアンダースコアで入力してください。先頭に数字は使えません。";
    }
  }
  // chain continuation (additional slots) の自由入力受付も同じバリデーションを行う。
  for (let i = 0; i < form.additionalMessages.length; i++) {
    const slot = form.additionalMessages[i];
    if (slot.free_input_enabled) {
      const key = slot.free_input_variable_key.trim();
      if (key && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        return `${i + 2}通目: 変数名は半角英数字とアンダースコアで入力してください。先頭に数字は使えません。`;
      }
    }
    // chain 内 Flex Message: altText 必須 + JSON 検証
    if (slot.message_type === "flex") {
      if (!slot.alt_text.trim()) return `${i + 2}通目: ${FLEX_ERRORS.emptyAltText}`;
      const norm = normalizeFlexJson(slot.flex_payload_json);
      if (!norm.ok) return `${i + 2}通目: ${norm.error}`;
    }
  }
  // ── 画像タップ時アクションバリデーション ──
  if (form.message_type === "image" && form.image_action_type) {
    if (form.image_action_type === "message" && !form.image_action_text.trim()) {
      return "画像タップ時アクション「メッセージを送信する」には、送信されるテキストが必須です";
    }
    if (form.image_action_type === "uri") {
      const url = form.image_action_url.trim();
      if (!url) return "URL アクションには URL が必須です";
      if (!url.startsWith("https://")) return "URL は https:// から始まるものを指定してください";
    }
    if (form.image_action_type === "liff" && !form.image_action_liff_page_id.trim()) {
      return "LIFF アクションには LIFF ページの選択が必須です";
    }
    if (form.image_action_type === "postback" && !form.image_action_postback_data.trim()) {
      return "postback アクションには data が必須です";
    }
  }
  // ── 共通メッセージバリデーション ──
  if (form.kind === "global") {
    if (!form.trigger_keyword.trim()) {
      return "共通メッセージにはキーワード（応答キーワード）が必須です";
    }
    if (form.message_type === "text" && !form.body.trim()) {
      return "テキスト本文は必須です";
    }
  }
  // ── 謎（puzzle）バリデーション ──
  if (form.kind === "puzzle") {
    // 謎の問題コンテンツ（配信形式ごと）
    if (form.message_type === "text" && !form.body.trim()) {
      return "謎の本文は必須です";
    }
    if (form.message_type === "image" && !form.asset_url.trim()) {
      return "画像 URL は必須です";
    }
    if (form.message_type === "video" && !form.asset_url.trim()) {
      return "動画 URL は必須です";
    }
    if (form.message_type === "carousel" && form.carousel_items.length === 0) {
      return "カードを1枚以上追加してください";
    }
    // 謎の答え・アクション設定
    if (!form.answer.trim()) return "答えは必須です";
    if (form.answer_match_type.length === 0) return "照合方法を1つ以上選択してください";
    if (!form.correct_action) return "正解時アクションを選択してください";
    if (
      (form.correct_action === "text" || form.correct_action === "text_and_transition") &&
      !form.correct_text.trim()
    ) {
      return "正解メッセージは必須です（アクション: テキスト返信）";
    }
    if (
      (form.correct_action === "transition" || form.correct_action === "text_and_transition") &&
      !form.correct_next_phase_id
    ) {
      return "遷移先フェーズを選択してください";
    }
    // フェーズ未設定の警告: 謎は phase_id がないと発火しない
    if (!form.phase_id) {
      return "フェーズが設定されていません。フェーズを指定しないと謎が発火しません。設定してから保存してください。";
    }
    return null;
  }
  // ── システム通知バリデーション ──
  if (form.kind === "system_notice") {
    if (!form.body.trim()) {
      return "システム通知の表示テキストを入力してください（例: ミカさんが入室しました）";
    }
    return null;
  }
  // ── 通常メッセージバリデーション ──
  if (form.message_type === "text" && !form.body.trim()) {
    return "テキスト本文は必須です";
  }
  if (
    (form.message_type === "image" ||
      form.message_type === "video" ||
      form.message_type === "voice") &&
    !form.asset_url.trim()
  ) {
    return `${
      form.message_type === "image"
        ? "画像"
        : form.message_type === "video"
        ? "動画"
        : "音声"
    } URL は必須です`;
  }
  if (form.message_type === "riddle" && !form.riddle_id) {
    return "謎を選択してください";
  }
  if (form.message_type === "carousel" && form.carousel_items.length === 0) {
    return "カードを1枚以上追加してください";
  }
  if (form.message_type === "flex") {
    // チェーンの「N通目: …」表記に合わせて 1通目も同じ文言設計にする。
    if (!form.alt_text.trim()) return `1通目: ${FLEX_ERRORS.emptyAltText}`;
    const norm = normalizeFlexJson(form.flex_payload_json);
    if (!norm.ok) return `1通目: ${norm.error}`;
  }
  return null;
}

// ── Props ────────────────────────────────────────────────

interface MessageFormProps {
  oaId:        string;
  workId:      string;
  workTitle:   string;
  initialForm: MessageFormState;
  isNew:       boolean;
  submitting:  boolean;
  deleting?:   boolean;
  onSubmit:    (form: MessageFormState) => void;
  onDelete?:   () => void;
  /** 編集中メッセージの ID（新規作成時は undefined） */
  messageId?:  string;
}

// ── スタイル定数 ──────────────────────────────────────────

const sectionHeader = {
  fontWeight: 600,
  fontSize: 13,
  color: "#374151",
  marginBottom: 12,
  paddingBottom: 6,
  borderBottom: "1px solid #e5e5e5",
} as const;

const fieldLabel = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 4,
} as const;

const hintText = {
  fontSize: 11,
  color: "#9ca3af",
  marginTop: 3,
} as const;

// ────────────────────────────────────────────────────────
// クイックリプライ — 定数
// ────────────────────────────────────────────────────────

const QR_PHASE_TYPE_LABEL: Record<string, string> = {
  start:  "開始",
  normal: "通常",
  ending: "エンディング",
  global: "全フェーズ共通",
};

/** QR アイテムの遷移先種別を返す */
function getQrTransitionType(item: QuickReplyItem): "none" | "message" | "phase" {
  if (item.target_type === "phase" || item.target_phase_id)  return "phase";
  if (item.target_type === "message")                        return "message";
  return "none";
}

const QR_ACTION_OPTIONS: { value: QuickReplyAction; label: string; icon: string; hint: string; valuePlaceholder?: string; valueLabel?: string; }[] = [
  {
    value: "text",
    label: "テキスト送信",
    icon: "",
    hint: "タップすると指定テキストをユーザーが送信します",
    valueLabel: "送信するテキスト",
    valuePlaceholder: "省略時はラベルを送信",
  },
  {
    value: "url",
    label: "URL を開く",
    icon: "🔗",
    hint: "タップすると外部 URL をブラウザで開きます",
    valueLabel: "URL",
    valuePlaceholder: "https://example.com",
  },
  {
    value: "next",
    label: "次へ進む",
    icon: "➡️",
    hint: "タップすると次のフェーズやメッセージへ進みます",
    valueLabel: "トリガーキーワード（任意）",
    valuePlaceholder: "省略時はシステムデフォルト",
  },
  {
    value: "hint",
    label: "ヒント",
    icon: "💡",
    hint: "タップするとヒント本文をボットが返信します",
    valueLabel: "ヒントキー",
    valuePlaceholder: "例: hint1（省略可）",
  },
  {
    value: "custom",
    label: "カスタム",
    icon: "",
    hint: "タップ時に任意のポストバックデータを送信します",
    valueLabel: "カスタムデータ",
    valuePlaceholder: "任意の文字列",
  },
];

/** 空のクイックリプライ雛形 */
const EMPTY_QR: QuickReplyItem = { label: "", action: "text", value: "" };

// ────────────────────────────────────────────────────────
// ヒントプレビューコンポーネント
// ────────────────────────────────────────────────────────

function QrHintPreview({ hintText, hintFollowup }: { hintText?: string; hintFollowup?: string }) {
  if (!hintText?.trim() && !hintFollowup?.trim()) return null;
  const bubble: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: "0 10px 10px 10px",
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "#374151",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxWidth: 220,
  };
  return (
    <div style={{
      background: "#f0fdf4",
      border: "1px solid #bbf7d0",
      borderRadius: 8,
      padding: "10px 12px",
      marginTop: 8,
    }}>
      <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, marginBottom: 7, letterSpacing: 0.5 }}>
        ユーザーへの返信プレビュー
      </div>
      {hintText?.trim() && <div style={bubble}>{hintText}</div>}
      {hintFollowup?.trim() && (
        <>
          <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 10, margin: "5px 0" }}>▼</div>
          <div style={bubble}>{hintFollowup}</div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// QuickReplyEditor コンポーネント
// ────────────────────────────────────────────────────────

interface QuickReplyEditorProps {
  items:    QuickReplyItem[];
  onChange: (items: QuickReplyItem[]) => void;
  /** kind=response メッセージ一覧（全フェーズ対象・フェーズ名付き表示） */
  responseMessages?: { id: string; body: string | null; phase_id?: string | null }[];
  /** 全フェーズ一覧（フェーズ名表示用） */
  phases?: { id: string; name: string; phase_type: string }[];
  /** 遷移先メッセージ一覧（全フェーズ対象・フェーズ名付き表示） */
  transitionMessages?: { id: string; body: string | null; kind: string; phase_id?: string | null }[];
  /** ヒントQRのキャラクター選択用（hint_character_id） */
  characters?: Character[];
  /** destination 統合用 */
  workId?: string;
  oaId?: string;
  destinations?: LineDestination[];
  /** 配信単位プレビュー用: work 内の全 message（chain walk / フェーズ入場算出） */
  allMessages?: QrPreviewMessage[];
}

function QuickReplyEditor({ items, onChange, responseMessages, phases, transitionMessages, characters = [], workId, oaId, destinations = [], allMessages = [] }: QuickReplyEditorProps) {
  const [open, setOpen]               = useState(false);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragSrcRef                    = useRef<number | null>(null);
  /** ドラッグを許可するのはハンドル経由のみ。このRefにindexをセットしてから dragStart する */
  const dragHandleRef                 = useRef<number | null>(null);
  /** 応答メッセージ選択のフェーズフィルタ（QR インデックス → フェーズ ID） */
  const [responsePhaseFilters,    setResponsePhaseFilters]    = useState<Record<number, string>>({});
  /** 遷移先メッセージ選択のフェーズフィルタ（QR インデックス → フェーズ ID） */
  const [transitionPhaseFilters,  setTransitionPhaseFilters]  = useState<Record<number, string>>({});

  // 自動展開: 既存データがある場合は初期表示で開く
  useEffect(() => {
    if (items.length > 0) setOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addItem() {
    if (items.length >= 13) return;
    const newIdx = items.length;
    onChange([...items, { ...EMPTY_QR }]);
    setExpandedSet((prev) => new Set([...prev, newIdx]));
    setOpen(true);
  }

  function updateItem(index: number, patch: Partial<QuickReplyItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
    setExpandedSet((prev) => {
      const next = new Set<number>();
      prev.forEach((n) => {
        if (n < index) next.add(n);
        else if (n > index) next.add(n - 1);
      });
      return next;
    });
  }

  function toggleExpand(index: number) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // ── ドラッグ & ドロップ ──
  function handleDragStart(e: React.DragEvent, index: number) {
    dragSrcRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(index);
  }
  function handleDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    const srcIdx = dragSrcRef.current;
    if (srcIdx === null || srcIdx === dropIdx) {
      setDragOverIdx(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(dropIdx, 0, moved);
    onChange(next);
    // expandedSet のインデックスを更新
    setExpandedSet((prev) => {
      const updated = new Set<number>();
      prev.forEach((n) => {
        if (n === srcIdx) {
          updated.add(dropIdx);
        } else if (srcIdx < dropIdx && n > srcIdx && n <= dropIdx) {
          updated.add(n - 1);
        } else if (srcIdx > dropIdx && n < srcIdx && n >= dropIdx) {
          updated.add(n + 1);
        } else {
          updated.add(n);
        }
      });
      return updated;
    });
    dragSrcRef.current = null;
    setDragOverIdx(null);
  }
  function handleDragEnd() {
    dragSrcRef.current = null;
    setDragOverIdx(null);
  }

  const enabledCount = items.filter((i) => i.enabled !== false).length;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* アコーディオンヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...sectionHeader, marginBottom: 0, paddingBottom: 0, borderBottom: "none" }}>
            クイックリプライ設定
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>（任意）</span>
          {items.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, background: "#06C755", color: "#fff", borderRadius: 10, padding: "1px 7px" }}>
              {enabledCount}/{items.length}件
            </span>
          )}
        </div>
        <span style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1 }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ ...hintText, marginBottom: 14 }}>
            メッセージの下に表示される選択肢ボタンです。LINE 仕様: 最大13件 / ラベル最大20文字。⠿ をドラッグして並び替え可能。
          </p>

          {/* アイテム一覧 */}
          {items.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {items.map((item, index) => {
                const isExpanded = expandedSet.has(index);
                const isEnabled  = item.enabled !== false;
                const isDragOver = dragOverIdx === index;
                const isHint     = item.action === "hint";

                return (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => {
                      // ハンドル以外からのドラッグは無効化
                      if (dragHandleRef.current !== index) {
                        e.preventDefault();
                        return;
                      }
                      handleDragStart(e, index);
                    }}
                    onDragOver={(e)  => handleDragOver(e, index)}
                    onDrop={(e)      => handleDrop(e, index)}
                    onDragEnd={() => { dragHandleRef.current = null; handleDragEnd(); }}
                    style={{
                      border:     isDragOver ? "2px dashed #06C755" : "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: isEnabled ? "#fafafa" : "#f1f5f9",
                      opacity:    isEnabled ? 1 : 0.6,
                      transition: "border 0.1s, opacity 0.15s",
                    }}
                  >
                    {/* ── カード折り畳みヘッダー ── */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 12px" }}>
                      <span
                        onPointerDown={() => { dragHandleRef.current = index; }}
                        onPointerUp={()   => { dragHandleRef.current = null;  }}
                        style={{ color: "#9ca3af", fontSize: 15, cursor: "grab", userSelect: "none", lineHeight: 1, touchAction: "none" }}
                        title="ドラッグして並び替え"
                      >⠿</span>

                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0, cursor: "pointer" }} onClick={() => toggleExpand(index)}>
                        {isHint && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#fffbeb", color: "#b45309", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0 }}>
                            💡 ヒント
                          </span>
                        )}
                        {!isHint && item.response_message_id && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0 }}>
                            🔗 応答
                          </span>
                        )}
                        {!isHint && (item.target_type === "phase" || item.target_phase_id) && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#f0fdf4", color: "#15803d", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0 }}>
                            ➡ フェーズ
                          </span>
                        )}
                        {!isHint && item.target_type === "message" && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#faf5ff", color: "#7c3aed", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0 }}>
                            ➡ メッセージ
                          </span>
                        )}
                        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.label || <span style={{ color: "#9ca3af" }}>（ラベル未設定）</span>}
                        </span>
                        {isHint && item.hint_text && (
                          <span style={{ fontSize: 11, color: "#b45309", flexShrink: 0 }} title="ヒント本文設定済み"></span>
                        )}
                        <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto", flexShrink: 0 }}>{isExpanded ? "▲" : "▼"}</span>
                      </div>

                      {/* ON/OFF トグル */}
                      <label onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", flexShrink: 0 }} title={isEnabled ? "クリックで無効化" : "クリックで有効化"}>
                        <div style={{ position: "relative", width: 30, height: 17, background: isEnabled ? "#06C755" : "#d1d5db", borderRadius: 9, transition: "background 0.2s" }}>
                          <div style={{ position: "absolute", top: 2, left: isEnabled ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)", transition: "left 0.18s", pointerEvents: "none" }} />
                          <input type="checkbox" checked={isEnabled} onChange={(e) => updateItem(index, { enabled: e.target.checked ? undefined : false })} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                        </div>
                        <span style={{ fontSize: 10, color: "#6b7280", width: 22 }}>{isEnabled ? "ON" : "OFF"}</span>
                      </label>

                      <button type="button" onClick={(e) => { e.stopPropagation(); removeItem(index); }} style={{ fontSize: 11, padding: "2px 7px", border: "1px solid #fecaca", borderRadius: 5, background: "#fff5f5", color: "#ef4444", cursor: "pointer", flexShrink: 0 }}>削除</button>
                    </div>

                    {/* ── 展開コンテンツ ── */}
                    {isExpanded && (
                      <div style={{ padding: "0 12px 12px", borderTop: "1px solid #e5e7eb" }}>

                        {/* QRタップ時フロー説明 */}
                        {!isHint && (
                          <div style={{
                            margin: "10px 0 12px",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontSize: 11,
                            color: "#475569",
                            lineHeight: 1.8,
                          }}>
                            <div style={{ fontWeight: 600, color: "#334155", marginBottom: 2 }}>QRタップ時の処理フロー</div>
                            <div>
                              <span style={{ fontWeight: 700, color: "#06C755" }}>Step 1</span>
                              {" — ユーザー入力として「"}
                              <span style={{ fontWeight: 600 }}>{item.label || "（ラベル未設定）"}</span>
                              {"」を送信"}
                            </div>
                            <div>
                              <span style={{ fontWeight: 700, color: "#1d4ed8" }}>Step 2</span>
                              {" — 応答メッセージを返す（下記設定）"}
                            </div>
                            <div>
                              <span style={{ fontWeight: 700, color: "#7c3aed" }}>Step 3</span>
                              {" — 遷移先へ進む（下記設定）"}
                            </div>
                          </div>
                        )}

                        {/* ボタンテキスト */}
                        <div className="form-group" style={{ marginTop: isHint ? 10 : 0, marginBottom: 10 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            ボタンテキスト <span style={{ color: "#dc2626" }}>*</span>
                            <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>({item.label.length}/20)</span>
                          </label>
                          <input type="text" className="form-input"
                            value={item.label}
                            onChange={(e) => {
                              const t = e.target.value;
                              // action="url" のときは label と value を分離（value は URL）
                              if (item.action === "url") {
                                updateItem(index, { label: t });
                              } else {
                                updateItem(index, { label: t, value: t || undefined });
                              }
                            }}
                            placeholder="例: 話を聞く"
                            maxLength={20}
                            style={{ fontSize: 13 }}
                          />
                          <div style={{ ...hintText, marginTop: 4 }}>
                            ボタンの表示文言・ユーザーが送信するテキスト・遷移トリガーとして使用されます
                          </div>
                        </div>

                        {/* URL遷移先（action="url" の場合のみ） */}
                        {item.action === "url" && workId && (
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <TapDestinationSection
                              label="遷移先URL"
                              workId={workId}
                              oaId={oaId ?? ""}
                              mode={item.destination_id ? "destination" : item.value ? "direct_url" : "destination"}
                              destinationId={item.destination_id ?? null}
                              directUrl={item.value ?? ""}
                              destinations={destinations}
                              onModeChange={(m) => {
                                if (m === "destination") updateItem(index, { value: undefined } as Partial<QuickReplyItem>);
                                if (m === "direct_url") updateItem(index, { destination_id: undefined } as Partial<QuickReplyItem>);
                                if (m === "none") updateItem(index, { destination_id: undefined, value: undefined } as Partial<QuickReplyItem>);
                              }}
                              onDestinationChange={(id) => updateItem(index, { destination_id: id } as Partial<QuickReplyItem>)}
                              onDirectUrlChange={(url) => updateItem(index, { value: url } as Partial<QuickReplyItem>)}
                            />
                          </div>
                        )}

                        {/* Step 2: 応答メッセージ（ヒントでない場合のみ） */}
                        {!isHint && item.action !== "url" && (responseMessages?.length ?? 0) > 0 && (
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ ...fieldLabel, fontSize: 12 }}>
                              <span style={{ fontWeight: 700, color: "#1d4ed8", fontSize: 11, marginRight: 6 }}>Step 2</span>
                              返す内容（応答メッセージ）
                              <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                            </label>
                            {/* フェーズフィルタ */}
                            {(phases ?? []).length > 0 && (
                              <select
                                className="form-input"
                                value={responsePhaseFilters[index] ?? ""}
                                onChange={(e) => setResponsePhaseFilters((prev) => ({ ...prev, [index]: e.target.value }))}
                                style={{ fontSize: 12, marginBottom: 6, color: "#6b7280" }}
                              >
                                <option value="">— すべてのフェーズ —</option>
                                {(phases ?? []).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    [{QR_PHASE_TYPE_LABEL[p.phase_type] ?? p.phase_type}] {p.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <select
                              className="form-input"
                              value={item.response_message_id ?? ""}
                              onChange={(e) => updateItem(index, { response_message_id: e.target.value || undefined })}
                              style={{ fontSize: 13 }}
                            >
                              <option value="">— 紐づけない —</option>
                              {(responseMessages ?? [])
                                .filter((m) => !responsePhaseFilters[index] || m.phase_id === responsePhaseFilters[index])
                                .map((m) => {
                                  const phase  = (phases ?? []).find((p) => p.id === m.phase_id);
                                  const prefix = phase ? `[${phase.name}] ` : "";
                                  const body   = m.body ?? "(本文なし)";
                                  const full   = prefix + body;
                                  return (
                                    <option key={m.id} value={m.id}>
                                      {full.length > 50 ? full.slice(0, 50) + "…" : full}
                                    </option>
                                  );
                                })}
                            </select>
                            <div style={{ ...hintText, marginTop: 4 }}>
                              QRタップ直後に bot が返す返答メッセージです。kind=response のメッセージを指定してください。
                              どのフェーズのメッセージも選択できます。
                            </div>
                          </div>
                        )}

                        {/* Step 3: 遷移先（ヒントでない場合のみ） */}
                        {!isHint && (
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ ...fieldLabel, fontSize: 12 }}>
                              <span style={{ fontWeight: 700, color: "#7c3aed", fontSize: 11, marginRight: 6 }}>Step 3</span>
                              遷移先（その後どこへ進むか）
                              <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                            </label>
                            {/* 3-way セグメントボタン */}
                            <div style={{ display: "flex", gap: 3, background: "#f3f4f6", borderRadius: 8, padding: 3, marginBottom: 8 }}>
                              {(["none", "message", "phase"] as const).map((t) => {
                                const current  = getQrTransitionType(item);
                                const isActive = current === t;
                                const lblMap   = { none: "なし", message: "メッセージ", phase: "フェーズ" } as const;
                                return (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => {
                                      if (t === "none") {
                                        updateItem(index, { target_phase_id: undefined, target_message_id: undefined, target_type: undefined });
                                      } else if (t === "message") {
                                        updateItem(index, { target_type: "message", target_phase_id: undefined });
                                      } else {
                                        // "phase": target_type="phase" をセットしてフェーズ選択欄を表示
                                        updateItem(index, { target_type: "phase", target_message_id: undefined });
                                      }
                                    }}
                                    style={{
                                      flex: 1, padding: "5px 0", fontSize: 12,
                                      fontWeight: isActive ? 700 : 400,
                                      border: "none", borderRadius: 6,
                                      background: isActive ? "#fff" : "transparent",
                                      color: isActive
                                        ? (t === "phase" ? "#15803d" : t === "message" ? "#7c3aed" : "#374151")
                                        : "#9ca3af",
                                      cursor: "pointer",
                                      boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                                      transition: "all 0.12s",
                                    }}
                                  >
                                    {lblMap[t]}
                                  </button>
                                );
                              })}
                            </div>

                            {/* フェーズ選択 */}
                            {getQrTransitionType(item) === "phase" && (
                              <>
                                <select
                                  className="form-input"
                                  value={item.target_phase_id ?? ""}
                                  onChange={(e) => updateItem(index, { target_phase_id: e.target.value || undefined })}
                                  style={{ fontSize: 13 }}
                                >
                                  <option value="">— フェーズを選択 —</option>
                                  {(phases ?? []).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      [{QR_PHASE_TYPE_LABEL[p.phase_type] ?? p.phase_type}] {p.name}
                                    </option>
                                  ))}
                                </select>
                                {(phases ?? []).length === 0 && (
                                  <div style={{ ...hintText, marginTop: 4, color: "#ef4444" }}>
                                    フェーズが読み込まれていません。保存してから再度開いてください。
                                  </div>
                                )}
                              </>
                            )}

                            {/* メッセージ選択 */}
                            {getQrTransitionType(item) === "message" && (
                              <>
                                {/* フェーズフィルタ */}
                                {(phases ?? []).length > 0 && (
                                  <select
                                    className="form-input"
                                    value={transitionPhaseFilters[index] ?? ""}
                                    onChange={(e) => setTransitionPhaseFilters((prev) => ({ ...prev, [index]: e.target.value }))}
                                    style={{ fontSize: 12, marginBottom: 6, color: "#6b7280" }}
                                  >
                                    <option value="">— すべてのフェーズ —</option>
                                    {(phases ?? []).map((p) => (
                                      <option key={p.id} value={p.id}>
                                        [{QR_PHASE_TYPE_LABEL[p.phase_type] ?? p.phase_type}] {p.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <select
                                  className="form-input"
                                  value={item.target_message_id ?? ""}
                                  onChange={(e) => updateItem(index, { target_message_id: e.target.value || undefined })}
                                  style={{ fontSize: 13 }}
                                >
                                  <option value="">— メッセージを選択 —</option>
                                  {(transitionMessages ?? [])
                                    .filter((m) => !transitionPhaseFilters[index] || m.phase_id === transitionPhaseFilters[index])
                                    .map((m) => {
                                      const phase  = (phases ?? []).find((p) => p.id === m.phase_id);
                                      const prefix = phase ? `[${phase.name}] ` : "";
                                      const body   = m.body ?? "(本文なし)";
                                      const full   = prefix + body;
                                      return (
                                        <option key={m.id} value={m.id}>
                                          {full.length > 50 ? full.slice(0, 50) + "…" : full}
                                        </option>
                                      );
                                    })}
                                </select>
                                {(transitionMessages ?? []).length === 0 && (
                                  <div style={{ ...hintText, marginTop: 4, color: "#ef4444" }}>
                                    メッセージが読み込まれていません。保存してから再度開いてください。
                                  </div>
                                )}
                              </>
                            )}

                            {getQrTransitionType(item) === "none" && (
                              <div style={{ ...hintText }}>
                                遷移先なし — Step 2 の応答メッセージだけを返して終了します
                              </div>
                            )}
                            {getQrTransitionType(item) !== "none" && (
                              <div style={{ ...hintText, marginTop: 4 }}>
                                Step 2 の応答メッセージを返した後、ここへ進みます。どのフェーズも選択可能です。
                              </div>
                            )}

                            {/* 配信単位プレビュー（実送信ロジック準拠） */}
                            {(() => {
                              const pv = previewQrSend(item, allMessages);
                              if (pv.mode === "none" || allMessages.length === 0) return null;
                              return (
                                <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, lineHeight: 1.6 }}>
                                  {pv.mode === "message_chain" && (
                                    <div style={{ color: "#7c3aed", marginBottom: 6 }}>
                                      ℹ️ このQRは<strong>指定メッセージの連続メッセージのみ</strong>送信します。同じフェーズ内の後続メッセージは自動では送信されません（続けたい場合は QR / 自由入力 / フェーズ遷移で明示的に接続してください）。
                                    </div>
                                  )}
                                  <div style={{ fontWeight: 700, color: "#475569" }}>
                                    このQRで送信されるメッセージ: {pv.total}通{pv.mode === "phase_entry" ? "（フェーズ入場）" : ""}
                                  </div>
                                  <ol style={{ margin: "4px 0 0", paddingLeft: 18, color: "#475569" }}>
                                    {pv.messages.map((mm) => (
                                      <li key={mm.id}>{(mm.body ?? `(${mm.message_type ?? "?"})`).replace(/\n/g, " ").slice(0, 24)}</li>
                                    ))}
                                  </ol>
                                  {pv.overLimit && pv.overflowKind === "dropped" && (
                                    <div style={{ marginTop: 6, color: "#b91c1c" }}>
                                      ⚠️ この連続メッセージは{pv.fullTotal}通あり、5通を超えています。<strong>6通目以降は送信されません</strong>（1チェーン最大5通）。5通以内に分割するか、QR / 自由入力 / フェーズ遷移で区切ってください。
                                    </div>
                                  )}
                                  {pv.overLimit && pv.overflowKind === "push" && (
                                    <div style={{ marginTop: 6, color: "#b91c1c" }}>
                                      ⚠️ この送信は合計{pv.total}通で、5通を超えています。<strong>6通目以降は Push 送信</strong>となり、月間上限などにより届かない可能性があります。QR / 自由入力 / フェーズ遷移で5通以内に区切ることをおすすめします。
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* ヒントボタントグル */}
                        <div style={{ marginBottom: isHint ? 10 : 0 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                            <div style={{ position: "relative", width: 30, height: 17, background: isHint ? "#f59e0b" : "#d1d5db", borderRadius: 9, transition: "background 0.2s" }}>
                              <div style={{ position: "absolute", top: 2, left: isHint ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)", transition: "left 0.18s", pointerEvents: "none" }} />
                              <input type="checkbox" checked={isHint}
                                onChange={(e) => updateItem(index, {
                                  action: e.target.checked ? "hint" : "text",
                                  ...(!e.target.checked ? { hint_text: undefined, hint_followup: undefined } : {}),
                                  // ヒントON時は応答メッセージ紐づけをクリア
                                  ...(e.target.checked ? { response_message_id: undefined } : {}),
                                })}
                                style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                              />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 500, color: isHint ? "#b45309" : "#6b7280" }}>
                              💡 ヒントボタンにする
                            </span>
                          </label>
                          {!isHint && <div style={{ ...hintText, marginTop: 4, marginLeft: 38 }}>ONにするとボタンタップ時にヒント本文を返信します</div>}
                        </div>

                        {/* ヒントフィールド */}
                        {isHint && (
                          <>
                            {/* ── 応答キャラクター ── */}
                            <div className="form-group" style={{ marginBottom: 8 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                応答キャラクター
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                              </label>
                              <select
                                className="form-input"
                                value={(item as { hint_character_id?: string | null }).hint_character_id ?? ""}
                                onChange={(e) => updateItem(index, { hint_character_id: e.target.value || null } as Partial<import("@/types").QuickReplyItem>)}
                                style={{ fontSize: 13 }}
                              >
                                <option value="">デフォルト（システムキャラクター）</option>
                                {characters.map((ch) => (
                                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                                ))}
                              </select>
                              <div style={{ ...hintText, marginTop: 3 }}>
                                このヒントを送信するキャラクター。未設定はシステムキャラクターが使われます。
                              </div>
                            </div>
                            {/* ── ヒント本文 ── */}
                            <div className="form-group" style={{ marginBottom: 8 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                ヒント本文 <span style={{ color: "#dc2626" }}>*</span>
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>({(item.hint_text ?? "").length}/2000)</span>
                              </label>
                              <textarea className="form-input"
                                value={item.hint_text ?? ""}
                                onChange={(e) => updateItem(index, { hint_text: e.target.value || undefined })}
                                placeholder="ユーザーがこのボタンをタップしたときに返信するヒント本文"
                                maxLength={2000} rows={3}
                                style={{ fontSize: 13, resize: "vertical", lineHeight: 1.5 }}
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 8 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                回答誘導メッセージ
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>({(item.hint_followup ?? "").length}/500)</span>
                              </label>
                              <input type="text" className="form-input"
                                value={item.hint_followup ?? ""}
                                onChange={(e) => updateItem(index, { hint_followup: e.target.value || undefined })}
                                placeholder="例: もう少しヒントが必要なら「ヒント②」を押してね"
                                maxLength={500} style={{ fontSize: 13 }}
                              />
                              <div style={{ ...hintText, marginTop: 4 }}>ヒント本文の直後に続けて送信されます</div>
                            </div>
                            <QrHintPreview hintText={item.hint_text} hintFollowup={item.hint_followup} />
                            {/* ヒント段階と導線ラベル */}
                            <div style={{ marginTop: 10, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 8 }}>ヒント導線設定</div>
                              <div className="form-group" style={{ marginBottom: 8 }}>
                                <label style={{ ...fieldLabel, fontSize: 12 }}>
                                  ヒント段階（順序）
                                  <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                                </label>
                                <input
                                  type="number"
                                  className="form-input"
                                  min={1}
                                  max={99}
                                  value={(item as { hint_level?: number }).hint_level ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    updateItem(index, { hint_level: v ? parseInt(v, 10) : undefined } as Partial<import("@/types").QuickReplyItem>);
                                  }}
                                  placeholder="例: 1（最初のヒント）、2（次のヒント）"
                                  style={{ fontSize: 13 }}
                                />
                                <div style={{ ...hintText, marginTop: 3 }}>数字が小さいほど先に表示されます。複数ヒントがある場合に設定してください。</div>
                              </div>
                              <div className="form-group" style={{ marginBottom: 8 }}>
                                <label style={{ ...fieldLabel, fontSize: 12 }}>
                                  「さらにヒント」ボタンラベル
                                  <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                                </label>
                                <input
                                  type="text"
                                  className="form-input"
                                  maxLength={20}
                                  value={(item as { hint_next_label?: string }).hint_next_label ?? ""}
                                  onChange={(e) => updateItem(index, { hint_next_label: e.target.value || undefined } as Partial<import("@/types").QuickReplyItem>)}
                                  placeholder="さらにヒント"
                                  style={{ fontSize: 13 }}
                                />
                                <div style={{ ...hintText, marginTop: 3 }}>このヒントを表示した後に「次のヒント」ボタンとして表示されるラベルです。</div>
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label style={{ ...fieldLabel, fontSize: 12 }}>
                                  「問題に戻る」ボタンラベル
                                  <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                                </label>
                                <input
                                  type="text"
                                  className="form-input"
                                  maxLength={20}
                                  value={(item as { hint_cancel_label?: string }).hint_cancel_label ?? ""}
                                  onChange={(e) => updateItem(index, { hint_cancel_label: e.target.value || undefined } as Partial<import("@/types").QuickReplyItem>)}
                                  placeholder="問題に戻る"
                                  style={{ fontSize: 13 }}
                                />
                                <div style={{ ...hintText, marginTop: 3 }}>このヒントを表示した後に「キャンセル」ボタンとして表示されるラベルです。</div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 追加ボタン */}
          <button
            type="button"
            onClick={addItem}
            disabled={items.length >= 13}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              border: "1.5px dashed #d1d5db",
              borderRadius: 8,
              background: items.length >= 13 ? "#f9fafb" : "#fff",
              color: items.length >= 13 ? "#9ca3af" : "#374151",
              fontSize: 13,
              fontWeight: 500,
              cursor: items.length >= 13 ? "not-allowed" : "pointer",
              width: "100%",
              justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            ＋ クイックリプライを追加
            {items.length >= 13 && (
              <span style={{ fontSize: 11, color: "#9ca3af" }}>（上限13件）</span>
            )}
          </button>
        </div>
      )}

      {/* 閉じているときのミニ追加ボタン */}
      {!open && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={addItem}
            style={{
              fontSize: 12, padding: "5px 12px",
              border: "1px dashed #d1d5db", borderRadius: 6,
              background: "#fff", color: "#6b7280", cursor: "pointer",
            }}
          >
            ＋ クイックリプライを追加
          </button>
        </div>
      )}
    </div>
  );
}

// ── キーワードリストエディタ ──────────────────────────────
//
// 応答キーワードを「1行 = 1キーワード」のリスト形式で編集する。
// 内部で行の配列を管理し、親には \n 区切りの文字列で渡す。

function KeywordListEditor({ value, onChange, disabled, phases, currentMessageId, allMessagesForLink }: {
  value:               string;
  onChange:            (v: string) => void;
  disabled?:           boolean;
  /** 全フェーズ一覧（QRピッカーのフェーズ選択用） */
  phases?:             { id: string; name: string; phase_type: string }[];
  /** 編集中メッセージ ID（QR連携ラベル表示用） */
  currentMessageId?:   string;
  /** allMessages（QR連携ラベル + QRピッカー用） */
  allMessagesForLink?: { id: string; phase_id?: string | null; quick_replies?: QuickReplyItem[] | null }[];
}) {
  const parse  = (v: string) => v.split("\n").map((k) => k.trim()).filter(Boolean);
  const commit = (rows: string[]) => onChange(rows.filter(Boolean).join("\n"));

  /** 親 value から parse した非空配列。初期値として使う */
  const [rows, setRows] = useState<string[]>(() => {
    const p = parse(value);
    return p.length > 0 ? p : [""];
  });

  /** QRピッカーで選択中のフェーズ ID */
  const [qrPickerPhaseId, setQrPickerPhaseId] = useState<string>("");

  /** 選択フェーズの QR ラベル一覧（未追加のもののみ） */
  const qrLabelsForSelectedPhase: string[] = qrPickerPhaseId
    ? (allMessagesForLink ?? [])
        .filter((m) => m.phase_id === qrPickerPhaseId && Array.isArray(m.quick_replies))
        .flatMap((m) => (m.quick_replies ?? []).map((qr) => qr.label).filter(Boolean) as string[])
        .filter((label, i, arr) =>
          arr.indexOf(label) === i &&
          !rows.filter(Boolean).some((r) => r.trim().toLowerCase().normalize("NFKC") === label.toLowerCase().normalize("NFKC"))
        )
    : [];

  // QR連携ラベル: 他メッセージのQRで response_message_id が currentMessageId に一致するもの
  const linkedQrLabels: string[] = currentMessageId
    ? (allMessagesForLink ?? [])
        .flatMap((m) =>
          (m.quick_replies ?? [])
            .filter((qr) => qr.response_message_id === currentMessageId && qr.label.trim())
            .map((qr) => qr.label.trim())
        )
        .filter((label, i, arr) => arr.indexOf(label) === i)
    : [];

  /**
   * 外部からの value 変更（フォームリセット・既存データ読み込み等）を検知して rows を同期する。
   * 自分の commit が発火させた変更は無視する（lastCommittedRef で追跡）。
   */
  const lastCommittedRef = useRef(value);
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      const p = parse(value);
      setRows(p.length > 0 ? p : [""]);
      lastCommittedRef.current = value;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function updateRow(i: number, val: string) {
    const next = [...rows];
    next[i] = val;
    setRows(next);
    const committed = next.filter(Boolean).join("\n");
    lastCommittedRef.current = committed;
    onChange(committed);
  }

  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    const final = next.length > 0 ? next : [""];
    setRows(final);
    const committed = next.filter(Boolean).join("\n");
    lastCommittedRef.current = committed;
    onChange(committed);
  }

  function addRow() {
    setRows((prev) => [...prev, ""]);
    // 空行は親に push しない
  }

  function addFromQr(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const existing = rows.filter(Boolean);
    if (existing.includes(trimmed)) return;
    const next = [...existing, trimmed];
    setRows(next);
    const committed = next.join("\n");
    lastCommittedRef.current = committed;
    onChange(committed);
  }

  return (
    <div>
      {/* QR連携ラベル（読み取り専用 - 保存時に自動マージ） */}
      {linkedQrLabels.length > 0 && (
        <div style={{
          marginBottom: 10, padding: "8px 10px",
          background: "#eff6ff", border: "1px solid #bfdbfe",
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#1d4ed8", marginBottom: 5 }}>
            🔗 QRから自動連携（保存時にキーワードへ追加されます）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {linkedQrLabels.map((label) => {
              const alreadyManual = rows.filter(Boolean).some(
                (k) => k.trim().toLowerCase().normalize("NFKC") === label.toLowerCase().normalize("NFKC")
              );
              return (
                <span
                  key={label}
                  style={{
                    fontSize: 11, padding: "2px 9px", borderRadius: 12,
                    background: alreadyManual ? "#f0fdf4" : "#dbeafe",
                    border: `1px solid ${alreadyManual ? "#bbf7d0" : "#93c5fd"}`,
                    color: alreadyManual ? "#15803d" : "#1e40af",
                    fontWeight: 500,
                  }}
                  title={alreadyManual ? "手動キーワードにも設定済み" : "QR連携ラベル"}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((kw, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              className="form-input"
              value={kw}
              onChange={(e) => updateRow(i, e.target.value)}
              onKeyDown={(e) => {
                // Enter で入力欄を増やさない / form submit を起こさない。
                // IME 変換中の Enter (= 変換確定) は素通りさせる。
                if (e.key !== "Enter") return;
                if (e.nativeEvent.isComposing) return;
                e.preventDefault();
              }}
              placeholder={i === 0 ? "例: 虹" : "例: にじ、rainbow …"}
              maxLength={100}
              disabled={disabled}
              style={{ fontSize: 13, flex: 1, ...(disabled ? { opacity: 0.5 } : {}) }}
            />
            {rows.length > 1 && !disabled && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                style={{
                  fontSize: 11, padding: "5px 10px", borderRadius: 6,
                  border: "1px solid #fecaca", background: "#fff5f5",
                  color: "#ef4444", cursor: "pointer", flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >削除</button>
            )}
          </div>
        ))}
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={addRow}
          style={{
            marginTop: 7, fontSize: 12, padding: "5px 12px",
            border: "1.5px dashed #d1d5db", borderRadius: 6,
            background: "#fff", color: "#6b7280", cursor: "pointer",
          }}
        >
          ＋ キーワードを追加
        </button>
      )}

      {/* QRピッカー（全フェーズ対象） */}
      {!disabled && (phases ?? []).length > 0 && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "#f8fafc", borderRadius: 8,
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>
            クイックリプライから選択
          </div>
          {/* フェーズ選択プルダウン */}
          <select
            value={qrPickerPhaseId}
            onChange={(e) => setQrPickerPhaseId(e.target.value)}
            style={{
              width: "100%", fontSize: 12, padding: "5px 8px",
              borderRadius: 6, border: "1px solid #d1d5db",
              marginBottom: 8, background: "#fff",
            }}
          >
            <option value="">— フェーズを選択 —</option>
            {(phases ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                [{QR_PHASE_TYPE_LABEL[p.phase_type] ?? p.phase_type}] {p.name}
              </option>
            ))}
          </select>
          {/* 選択フェーズのQRラベル一覧 */}
          {qrPickerPhaseId && (
            qrLabelsForSelectedPhase.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {qrLabelsForSelectedPhase.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => addFromQr(label)}
                    style={{
                      fontSize: 11, padding: "2px 9px", borderRadius: 12,
                      border: "1px solid #bfdbfe", background: "#eff6ff",
                      color: "#1d4ed8", cursor: "pointer",
                    }}
                  >+ {label}</button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#9ca3af" }}>
                このフェーズにはクイックリプライが設定されていません
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── 画像アップローダー ────────────────────────────────────
//
// Cloudinary (POST /api/upload) へアップロードし、secure_url (HTTPS) を form state に反映する。
// キャラクターアイコン / LIFF ブロック画像と同じアップローダーを共有する形に統一。
//
// (履歴) 旧実装は Supabase Storage 経由 (`uploadApi.uploadToStorage`) だったが
// Supabase 環境変数が未設定で 500 になっていたため、既に動作実績のある Cloudinary 経路へ変更。

const UPLOAD_ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const UPLOAD_MAX_BYTES      = 5 * 1024 * 1024; // 5 MB

interface ImageUploaderProps {
  value:    string;   // 現在の asset_url（空文字 = 未設定）
  onChange: (url: string) => void;
  /** @deprecated 旧 Supabase 実装のシグネチャ互換のため受けるが Cloudinary 化後は未使用 */
  oaId?:    string;
  /** @deprecated 同上 */
  workId?:  string;
  disabled?: boolean;
}

function ImageUploader({ value, onChange, disabled }: ImageUploaderProps) {
  const [uploading,    setUploading]    = useState(false);
  const [uploadError,  setUploadError]  = useState<string | null>(null);
  const [dragOver,     setDragOver]     = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasImage = !!value.trim();

  async function handleFile(file: File) {
    setUploadError(null);

    // クライアント側バリデーション（サーバーと同じ条件）
    if (!UPLOAD_ALLOWED_TYPES.includes(file.type)) {
      setUploadError(`JPEG / PNG / WebP のみ対応しています（受信: ${file.type}）`);
      return;
    }
    if (file.size === 0) {
      setUploadError("ファイルが空です");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadError(
        `ファイルサイズは 5MB 以下にしてください（現在: ${(file.size / 1024 / 1024).toFixed(1)}MB）`
      );
      return;
    }

    setUploading(true);
    try {
      const token = getDevToken();
      const { url } = await uploadApi.uploadImage(token, file);
      if (!url || !/^https:\/\//.test(url)) {
        throw new Error("アップロードレスポンスの URL が不正です (HTTPS でない)");
      }
      onChange(url);
      setShowUrlInput(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "アップロードに失敗しました";
      console.error("[ImageUploader] upload failed", err);
      setUploadError(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!disabled && !uploading) setDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleClear() {
    onChange("");
    setUploadError(null);
    setShowUrlInput(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleInputChange}
        disabled={disabled || uploading}
        style={{ display: "none" }}
      />

      {/* ── URL 直接入力モード ── */}
      {showUrlInput ? (
        <div>
          <input
            type="url"
            className="form-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com/image.png"
            disabled={disabled}
            style={{ fontFamily: "monospace", fontSize: 13 }}
            autoFocus
          />
          {value.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="プレビュー"
              style={{
                marginTop: 8, display: "block",
                maxWidth: 260, maxHeight: 160, objectFit: "contain",
                borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb",
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </div>
      ) : hasImage ? (
        /* ── 画像プレビューモード ── */
        <div style={{ position: "relative", display: "inline-block" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="画像プレビュー"
            style={{
              maxWidth: 300, maxHeight: 200, objectFit: "contain", display: "block",
              borderRadius: 10, border: "1px solid #e5e7eb", background: "#f9fafb",
            }}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.opacity = "0.25";
              img.alt = "画像を読み込めません";
            }}
          />
          {/* アップロード中オーバーレイ */}
          {uploading && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(255,255,255,0.82)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              borderRadius: 10, gap: 6,
            }}>
              <span style={{ fontSize: 22 }}>🔄</span>
              <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>アップロード中...</span>
            </div>
          )}
        </div>
      ) : (
        /* ── ドロップゾーン ── */
        <div
          onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
          style={{
            border: `2px dashed ${dragOver ? "#06C755" : "#d1d5db"}`,
            borderRadius: 12,
            padding: "32px 20px",
            textAlign: "center",
            cursor: disabled || uploading ? "default" : "pointer",
            background: dragOver ? "#f0fdf4" : "#fafafa",
            transition: "border-color 0.15s, background 0.15s",
            outline: "none",
          }}
        >
          {uploading ? (
            <>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🔄</div>
              <div style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>アップロード中...</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🖼</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: dragOver ? "#059669" : "#374151", marginBottom: 5 }}>
                {dragOver ? "ここにドロップ" : "クリックまたはドラッグ&ドロップで画像を追加"}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>JPEG / PNG / WebP・最大 5MB</div>
            </>
          )}
        </div>
      )}

      {/* エラー表示 */}
      {uploadError && (
        <div style={{
          marginTop: 8, padding: "7px 11px",
          background: "#fff5f5", border: "1px solid #fecaca",
          borderRadius: 7, fontSize: 12, color: "#dc2626",
          display: "flex", alignItems: "flex-start", gap: 6,
        }}>
          <span style={{ flexShrink: 0 }}>❌</span>
          <span>{uploadError}</span>
        </div>
      )}

      {/* 操作ボタン群 */}
      {!disabled && !uploading && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          {hasImage && !showUrlInput && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  fontSize: 12, padding: "4px 12px",
                  border: "1px solid #d1d5db", borderRadius: 6,
                  background: "#fff", color: "#374151", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                🔄 差し替え
              </button>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  fontSize: 12, padding: "4px 12px",
                  border: "1px solid #fecaca", borderRadius: 6,
                  background: "#fff5f5", color: "#ef4444", cursor: "pointer",
                }}
              >
                削除
              </button>
            </>
          )}
          {/* URL直接入力トグル */}
          <button
            type="button"
            onClick={() => setShowUrlInput((v) => !v)}
            style={{
              fontSize: 11, padding: "3px 10px",
              border: "1px solid #e5e7eb", borderRadius: 6,
              background: showUrlInput ? "#f1f5f9" : "transparent",
              color: "#6b7280", cursor: "pointer",
            }}
            title="既存の画像 URL を直接貼り付ける場合はこちら"
          >
            {showUrlInput ? "▲ アップロードに切り替え" : "🔗 URLで直接入力"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── LINEプレビューパネル ──────────────────────────────────

interface PreviewPanelProps {
  /** 1 登録分のメッセージチェーン (= 親方向遡行 + 編集中 form + 追加 slot)。
   *  常に 1 件以上 (= 最低でも編集中 form が含まれる)。 */
  chain:        ChainPreviewItem[];
  characters:   Character[];
  riddles:      Riddle[];
  destinations: LineDestination[];
}

/** 1 件のチェーン item から bubble 内コンテンツ (本文 / 画像 / 動画 / カルーセル等) を生成する。
 *  従来の PreviewPanel が form を直接見ていた箇所を ChainPreviewItem ベースに置き換えたもの。 */
function renderBubbleContent(
  item:         ChainPreviewItem,
  selectedRiddle: Riddle | undefined,
  destinations: LineDestination[],
): React.ReactNode {
  // 謎 (puzzle) は配信形式 (message_type) ごとのコンテンツ + 謎バッジ。chain head のみに来る想定。
  if (item.kind === "puzzle") {
    let puzzleContentEl: React.ReactNode;
    switch (item.message_type) {
      case "image":
        puzzleContentEl = item.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.asset_url} alt="謎画像プレビュー"
            style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, objectFit: "cover", display: "block" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div style={{ width: 160, height: 100, background: "#e5e7eb", borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#9ca3af" }}>🖼</div>
        );
        break;
      case "video":
        puzzleContentEl = (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 24 }}>🎬</span>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>動画</div>
              {item.asset_url && <div style={{ fontSize: 10, color: "#9ca3af", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.asset_url}</div>}
            </div>
          </div>
        );
        break;
      case "carousel":
        puzzleContentEl = item.carousel_items.length === 0
          ? <span style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>カードを追加してください</span>
          : (
            <div style={{ overflowX: "auto", display: "flex", gap: 8, paddingBottom: 4 }}>
              {item.carousel_items.map((card, idx) => (
                <div key={idx} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, width: 130, flexShrink: 0, overflow: "hidden" }}>
                  {card.image_url
                    ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.image_url} alt="" style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )
                    : <div style={{ width: "100%", height: 50, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#9ca3af" }}>🖼</div>
                  }
                  <div style={{ padding: "5px 7px" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title || `カード ${idx + 1}`}</div>
                    {card.button_label && <div style={{ marginTop: 4, padding: "2px 6px", background: "#06C755", color: "#fff", borderRadius: 4, fontSize: 9, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.button_label}</div>}
                  </div>
                </div>
              ))}
            </div>
          );
        break;
      default: // text
        puzzleContentEl = item.body
          ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.body}</span>
          : <span style={{ color: "#aaa", fontStyle: "italic" }}>謎の本文を入力してください</span>;
    }
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, background: "#fff7ed", color: "#c2410c",
            border: "1px solid #fed7aa", padding: "1px 7px", borderRadius: 10,
          }}>
            🧩 謎チャレンジ
          </span>
          {item.puzzle_type && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>{item.puzzle_type}</span>
          )}
        </div>
        {puzzleContentEl}
        {item.answer && (
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 5 }}>
            答え: <span style={{ fontWeight: 600, color: "#6b7280" }}>{item.answer}</span>
          </div>
        )}
      </div>
    );
  }

  switch (item.message_type) {
    case "text": {
      if (!item.body) {
        return <span style={{ color: "#aaa", fontStyle: "italic" }}>テキストを入力してください</span>;
      }
      const PLACEHOLDER_MAP: Record<string, string> = {
        "{{user_name}}":    "友だちの表示名",
        "{{account_name}}": "アカウント名",
      };
      const parts = item.body.split(/({{user_name}}|{{account_name}})/g);
      return (
        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {parts.map((part, i) =>
            PLACEHOLDER_MAP[part] ? (
              <span key={i} style={{
                display: "inline-block", fontSize: 11, fontWeight: 700,
                padding: "1px 7px", borderRadius: 12, margin: "0 1px",
                background: "#E6F7ED", color: "#059669", border: "1px solid #06C755",
              }}>
                {PLACEHOLDER_MAP[part]}
              </span>
            ) : part
          )}
        </span>
      );
    }
    case "image": {
      const tapInfo = item.tap_destination_id
        ? destinations.find((d) => d.id === item.tap_destination_id)?.name
        : item.tap_url
        ? "直接URL"
        : null;
      return (
        <div>
          {item.asset_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.asset_url} alt="画像プレビュー"
              style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, objectFit: "cover", display: "block" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 160, height: 100, background: "#e5e7eb", borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#9ca3af" }}>🖼</div>
          )}
          {tapInfo && (
            <div style={{ fontSize: 10, color: "#0d9488", marginTop: 4 }}>🔗 {tapInfo}</div>
          )}
        </div>
      );
    }
    case "riddle":
      return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>謎チャレンジ</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>
              {selectedRiddle
                ? selectedRiddle.title
                : <span style={{ color: "#aaa", fontStyle: "italic" }}>謎を選択してください</span>}
            </div>
          </div>
        </div>
      );
    case "video":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 24 }}>🎬</span>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>動画</div>
            {item.asset_url && <div style={{ fontSize: 10, color: "#9ca3af", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.asset_url}</div>}
          </div>
        </div>
      );
    case "voice":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🎙</span>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>ボイスメッセージ</div>
            {item.asset_url && <div style={{ fontSize: 10, color: "#9ca3af", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.asset_url}</div>}
          </div>
        </div>
      );
    case "carousel":
      return item.carousel_items.length === 0
        ? <span style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>カードを追加してください</span>
        : (
          <div style={{ overflowX: "auto", display: "flex", gap: 8, paddingBottom: 4 }}>
            {item.carousel_items.map((card, idx) => (
              <div key={idx} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, width: 130, flexShrink: 0, overflow: "hidden" }}>
                {card.image_url
                  ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.image_url} alt="" style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )
                  : <div style={{ width: "100%", height: 50, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#9ca3af" }}>🖼</div>
                }
                <div style={{ padding: "5px 7px" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title || `カード ${idx + 1}`}</div>
                  {card.button_label && <div style={{ marginTop: 4, padding: "2px 6px", background: "#06C755", color: "#fff", borderRadius: 4, fontSize: 9, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.button_label}</div>}
                </div>
              </div>
            ))}
          </div>
        );
    case "flex":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🧱</span>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Flex Message</div>
        </div>
      );
  }
  return null;
}

/** チェーン 1 通分の行 (= キャラ icon + 吹き出し + 直下に QR)。
 *  実機 LINE と同じく QR はその bubble の直下にのみ表示する (= 末尾集約しない)。 */
/** チェーン末尾の bubble の下に集約表示する QR の中立グレー系チップスタイル
 *  (= 実機 LINE のクイックリプライ表示トーンに揃える)。 */
const QR_TAIL_CHIP_STYLE = {
  display:      "inline-flex" as const,
  alignItems:   "center"      as const,
  gap:          3,
  padding:      "4px 12px",
  borderRadius: 20,
  fontSize:     11,
  fontWeight:   500 as const,
  background:   "#f8f8f8",
  color:        "#444",
  border:       "1px solid #d9d9d9",
  maxWidth:     160,
  overflow:     "hidden"      as const,
  textOverflow: "ellipsis"    as const,
  whiteSpace:   "nowrap"      as const,
  cursor:       "default"     as const,
};

function ChainBubbleRow({
  item, characters, riddles, destinations, tailQuickReplies,
}: {
  item:         ChainPreviewItem;
  characters:   Character[];
  riddles:      Riddle[];
  destinations: LineDestination[];
  /** chain 末尾の bubble にのみ表示する QR。それ以外の行は呼び出し側で空配列を渡す。
   *  ここに値があるかどうかで「自分が chain 末尾かどうか」を判定する。 */
  tailQuickReplies?: QuickReplyItem[];
}) {
  const selectedChar = characters.find((c) => c.id === item.character_id) ?? null;
  const selectedRiddle = riddles.find((r) => r.id === item.riddle_id);

  const iconEl = selectedChar ? (
    selectedChar.icon_image_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={selectedChar.icon_image_url}
        alt={selectedChar.name}
        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    ) : (
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: selectedChar.icon_color ?? "#06C755",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: "#fff",
      }}>
        {selectedChar.icon_type === "text"
          ? (selectedChar.icon_text ?? selectedChar.name[0])
          : selectedChar.name[0]}
      </div>
    )
  ) : (
    <div style={{
      width: 36, height: 36, borderRadius: "50%",
      background: "#c9cdd4", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
    }}></div>
  );

  // tail QR から空ラベル / 未設定 entry を除外する (= 表示価値のないチップを抑止)。
  const visibleQRs = (tailQuickReplies ?? []).filter((qr) => qr.label || qr.action);

  return (
    <div>
      {/* notify_text (テキスト以外) */}
      {item.message_type !== "text" && item.notify_text && (
        <div style={{ textAlign: "center", marginBottom: 10, fontSize: 11, color: "rgba(0,0,0,0.4)",
          background: "rgba(255,255,255,0.45)", borderRadius: 10, padding: "3px 12px",
          display: "inline-block", marginLeft: "50%", transform: "translateX(-50%)" }}>
          {item.notify_text}
        </div>
      )}

      {/* キャラ + 吹き出し */}
      <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0 }}>{iconEl}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedChar && (
            <p style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", marginBottom: 4, fontWeight: 400 }}>
              {selectedChar.name}
            </p>
          )}
          <div style={{ position: "relative", display: "inline-block", maxWidth: 220 }}>
            <div style={{
              position: "absolute", left: -6, top: 10,
              width: 0, height: 0, borderStyle: "solid",
              borderWidth: "5px 7px 5px 0",
              borderColor: "transparent #fff transparent transparent",
            }} />
            <div style={{
              background: "#fff", borderRadius: "4px 16px 16px 16px",
              padding: "8px 12px", fontSize: 14, color: "#111",
              lineHeight: 1.55, wordBreak: "break-word",
              boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.1)",
            }}>
              {renderBubbleContent(item, selectedRiddle, destinations)}
            </div>
          </div>

          {/* QR は chain 末尾の bubble の下にのみ表示 (= 実送信仕様 moveQuickReplyToTail に揃える)。
              tailQuickReplies が空 / 未指定なら何も表示しない。 */}
          {visibleQRs.length > 0 && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6,
            }}>
              {visibleQRs.map((qr, i) => {
                const actionDef = QR_ACTION_OPTIONS.find((o) => o.value === qr.action);
                return (
                  <span
                    key={i}
                    title={`${actionDef?.label ?? qr.action}${qr.value ? ` → ${qr.value}` : ""}`}
                    style={QR_TAIL_CHIP_STYLE}
                  >
                    {qr.label || <span style={{ fontStyle: "italic", opacity: 0.6 }}>ラベル未入力</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({ chain, characters, riddles, destinations }: PreviewPanelProps) {
  // ヘッダー (= LINE トーク画面の上部) は chain head の character を表示する。
  // chain は最低でも 1 件持つ (= 編集中 form) ので head は常に存在する。
  const head = chain[0];
  const selectedChar = head ? (characters.find((c) => c.id === head.character_id) ?? null) : null;

  // chain 内のどこかに QR がある場合、それを chain 末尾の bubble に集約して表示する。
  // 探索順は後ろから前 = 実送信処理の moveQuickReplyToTail と同じ姿勢 (= tail が
  // 既に QR を持っていればそれを使い、無ければ後方から遡って見つけた最初のものを使う)。
  let tailQR: QuickReplyItem[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].quick_replies.length > 0) {
      tailQR = chain[i].quick_replies;
      break;
    }
  }

  return (
    <div style={{
      border: "1px solid #d1d5db", borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)",
      background: "#fff",
    }}>
      {/* トークヘッダー */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e9ecef",
        padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 20, color: "#9ca3af", lineHeight: 1, marginTop: -1 }}>‹</span>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>
            {selectedChar ? selectedChar.name : "（キャラ未選択）"}
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#06C755", background: "#E6F7ED",
          padding: "2px 7px", borderRadius: 8, border: "1px solid #06C75533" }}>
          LINE
        </span>
      </div>

      {/* チャットエリア — チェーン 1 通分ずつ ChainBubbleRow で描画する */}
      <div style={{
        background: "#c4dde3", padding: "14px 12px 18px",
        minHeight: 280,
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {chain.map((item, i) => (
          <ChainBubbleRow
            key={item.key}
            item={item}
            characters={characters}
            riddles={riddles}
            destinations={destinations}
            // 末尾 bubble にのみ集約 QR を渡す。途中の bubble は QR を出さない。
            tailQuickReplies={i === chain.length - 1 ? tailQR : []}
          />
        ))}
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────
// AdditionalMessageBlock — 2通目以降のメッセージブロック
// ────────────────────────────────────────────────────────
// 演出設定セクション
// ────────────────────────────────────────────────────────

// 既読モード選択肢。「OFF (人為的な既読遅延なし)」= "immediate"。
// 継承モードは廃止 (= ユーザー方針: すべての演出設定は OFF をデフォルトとして明示する)。
const READ_RECEIPT_MODE_OPTIONS = [
  { value: "immediate",     label: "OFF（即時）" },
  { value: "delayed",       label: "遅延" },
  { value: "before_reply",  label: "返信直前" },
] as const;

// boolean 系演出設定 (送信前待機 / 「入力中...」表示) の選択肢。継承モード廃止。
const BOOL_OPTIONS = [
  { value: "false", label: "OFF" },
  { value: "true",  label: "ON" },
] as const;

// 演出設定 UI が要求する最小フィールド集合。
// MessageFormState (1 通目) と AdditionalMessageSlot (2 通目以降) は両方とも
// この共通形を満たすため、TimingConfigSection は両方で再利用できる。
type TimingFormFields = {
  body?: string;  // PreviewPlayer のサンプル本文として使う
  read_receipt_mode:    string;
  read_delay_ms:        string;
  typing_enabled:       string;
  typing_min_ms:        string;
  typing_max_ms:        string;
  loading_enabled:      string;
  loading_threshold_ms: string;
  loading_min_seconds:  string;
  loading_max_seconds:  string;
};

function TimingConfigSection<T extends TimingFormFields>({
  form,
  set,
  isAdditional,
  headDelayMs,
  onHeadDelayChange,
}: {
  form: T;
  set: <K extends keyof T>(key: K, val: T[K]) => void;
  /** 追加 (2 通目以降) のメッセージ用なら true。既読遅延の制約注記を出すために使う。 */
  isAdditional?: boolean;
  /**
   * 1 通目のみ: 「返信までの待機時間」(= lag_ms) を演出設定の最上部に表示する。
   * onHeadDelayChange を渡したときだけ描画する（2 通目以降は各ブロック側で持つため渡さない）。
   * 値の保存は呼び出し側 (form.lag_ms / set("lag_ms")) が担い、本コンポーネントは表示のみ。
   */
  headDelayMs?: number;
  onHeadDelayChange?: (ms: number) => void;
}) {
  // UI 統一: 自由入力受付セクションと同じ SectionAccordion をベースに使う。
  // 値が既に設定されていれば初期展開する。
  const hasValues = !!(form.read_receipt_mode || form.typing_enabled || form.loading_enabled);
  // 「返信までの待機時間」が設定されているか（折りたたみ時のバッジ表示用）。
  const hasHeadDelay = typeof headDelayMs === "number" && headDelayMs > 0;
  const headDelayLabel = hasHeadDelay ? `待機${Math.round((headDelayMs as number) / 100) / 10}秒` : null;

  const miniLabel = {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    color: "#6b7280",
    marginBottom: 2,
  };

  const inlineRow = {
    display: "flex",
    gap: 10,
    alignItems: "end",
    flexWrap: "wrap" as const,
  };

  const miniInput = {
    maxWidth: 120,
  };

  return (
    <SectionAccordion
      title="演出設定"
      optional
      description={onHeadDelayChange
        ? "返信までの待機時間・既読タイミング・「入力中…」表示などを設定できます。"
        : "既読タイミング・「入力中…」表示などを設定できます。"}
      defaultOpen={hasValues || hasHeadDelay}
      badge={(hasValues || hasHeadDelay) ? (
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {headDelayLabel && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e",
              borderRadius: 4, padding: "1px 6px",
            }}>{headDelayLabel}</span>
          )}
          {hasValues && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8",
              borderRadius: 4, padding: "1px 6px",
            }}>設定あり</span>
          )}
        </span>
      ) : undefined}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* ── 返信までの待機時間（1通目の lag_ms = 実機反映される唯一の待機項目） ──
              演出設定の最上部に配置。保存挙動は呼び出し側 set("lag_ms") に委譲（表示のみ移動）。 */}
          {onHeadDelayChange && (
            <div>
              <label style={miniLabel}>返信までの待機時間</label>
              <DurationInput
                valueMs={headDelayMs ?? 0}
                onChange={(ms) => onHeadDelayChange(ms)}
              />
              <div style={hintText}>ユーザーの入力後、このメッセージを送る前に待つ時間です</div>
            </div>
          )}

          {/* ── 既読 ── */}
          <div>
            <label style={miniLabel}>既読タイミング</label>
            <select
              className="form-input"
              style={{ maxWidth: 200 }}
              value={form.read_receipt_mode}
              onChange={(e) => set("read_receipt_mode", e.target.value)}
            >
              {READ_RECEIPT_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {form.read_receipt_mode === "delayed" && (
            <div>
              <label style={miniLabel}>既読遅延</label>
              <DurationInput
                valueMs={Number(form.read_delay_ms || 0)}
                onChange={(ms) => set("read_delay_ms", String(Math.min(ms, 600000)))}
              />
              <div style={hintText}>未入力 = デフォルト値を使用</div>
            </div>
          )}
          {isAdditional && (
            <div style={{ ...hintText, color: "#92400e", marginTop: -4 }}>
              ※ 既読遅延は現在、最初のメッセージにのみ実機反映されます。「入力中...」表示は反映されます。
            </div>
          )}

          {/* ── 旧「送信前の待機時間（画面には表示されません）」(= typing 風の不可視 sleep) は UI から撤去 ──
              理由: 実機の待機は lag_ms（「返信までの待機時間」/「前のメッセージからの待機時間」）に一本化。
              typing 系（typing_enabled / typing_min_ms / typing_max_ms）は「返信までの待機時間」と
              区別がつかずユーザーを混乱させていたため非表示にする。
              既存データは form state（typing_*）として load/save され続けるので破壊しない（runtime 挙動も不変）。
              新規に typing を設定する導線のみ廃止する。 */}

          {/* ── 「入力中...」表示（旧: ローディングアニメーション） ──
              実装: LINE LoadingAnimation API (POST /chat/loading/start)。
              LINE 仕様で最小 5 秒・1 chat に 1 つのみ・表示中は再トリガー無視。 */}
          <div>
            <label style={miniLabel}>「入力中...」表示</label>
            <select
              className="form-input"
              style={{ maxWidth: 120 }}
              value={form.loading_enabled}
              onChange={(e) => set("loading_enabled", e.target.value)}
            >
              {BOOL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {isAdditional && form.loading_enabled === "true" && (
            <div style={{ ...hintText, color: "#92400e", marginTop: -4 }}>
              ※ 「入力中...」表示は LINE 側の挙動 (最小 5 秒・1 チャットに 1 つ) により、連続メッセージそれぞれの直前に必ず表示されるとは限りません (= best-effort)。確実に「間」を作りたい場合は「前のメッセージからの待機時間」を設定してください。
            </div>
          )}
          {form.loading_enabled === "true" && (
            <>
              <div>
                <label style={miniLabel}>表示閾値（ms）</label>
                <input
                  type="number"
                  className="form-input"
                  style={miniInput}
                  value={form.loading_threshold_ms}
                  onChange={(e) => set("loading_threshold_ms", e.target.value)}
                  min={0}
                  max={30000}
                  step={500}
                  placeholder="3000"
                />
                <div style={hintText}>処理時間がこの値を超えたら「入力中...」を表示</div>
              </div>
              <div style={inlineRow}>
                <div>
                  <label style={miniLabel}>最小秒数</label>
                  <input
                    type="number"
                    className="form-input"
                    style={miniInput}
                    value={form.loading_min_seconds}
                    onChange={(e) => set("loading_min_seconds", e.target.value)}
                    min={3}
                    max={60}
                    step={1}
                    placeholder="5"
                  />
                </div>
                <div>
                  <label style={miniLabel}>最大秒数</label>
                  <input
                    type="number"
                    className="form-input"
                    style={miniInput}
                    value={form.loading_max_seconds}
                    onChange={(e) => set("loading_max_seconds", e.target.value)}
                    min={3}
                    max={60}
                    step={1}
                    placeholder="15"
                  />
                </div>
              </div>
            </>
          )}

          <div style={{ ...hintText, marginTop: 4 }}>
            未設定の項目はデフォルト設定（環境変数）を継承します
          </div>

          {/* 演出は「このメッセージ送信前」にのみ反映される旨の誤解防止文言（まとめ送信廃止方針・Phase 1）。 */}
          <div style={{ marginTop: 8, padding: "8px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 11, color: "#1e40af", lineHeight: 1.6 }}>
            待機時間・入力中表示は、<strong>このメッセージを送信する前</strong>に反映されます。次のメッセージにも演出を入れたい場合は、Quick Reply やキーワードなど、<strong>ユーザー操作を挟んで</strong>次のメッセージへ進めてください。
          </div>
      </div>
    </SectionAccordion>
  );
}

// ── プレビュー用 chain build helper ───────────────────────
//
// 1 登録 (= chain head + 連続メッセージ群) を form の live state + API データから
// 組み立てる。実送信処理 (buildPhaseMessages) は一切変更せず、フロント側で
// 同等の見た目を再現するためだけの関数。
//
// 入力:
//   - messageId    : 編集中メッセージの ID (新規作成中は undefined)
//   - form         : 現在の form state (= 1 通目 + additionalMessages を live で持つ)
//   - allMessages  : work 内の全 message (= API から取得済み snapshot)
//
// 出力:
//   ChainPreviewItem[] (= head→tail 順)。常に編集中 message を含む。
//   1 通のみの登録なら長さ 1。最大 PREVIEW_CHAIN_MAX。
//   循環は visited Set で防ぐ。
const PREVIEW_CHAIN_MAX = 8; // safety cap (= LINE 仕様 5 + 多少の余裕)

/** PreviewPanel が 1 吹き出しを描画するのに必要な最小データセット。
 *  form / AdditionalMessageSlot / API row どれから来ても同形になるよう正規化する。
 *  - quick_replies は「この吹き出し自身に付属」する分のみ持つ (= per-bubble 表示)。
 *  - tap_*, puzzle_*, riddle_id は puzzle / image-tap-action の表示判定で使う。
 *    chain 継続側はこれらを持たないため空文字 / null で埋める。 */
interface ChainPreviewItem {
  key:                 string;
  message_type:        ExtendedMessageType;
  body:                string;
  asset_url:           string;
  notify_text:         string;
  carousel_items:      MessageCarouselCard[];
  character_id:        string;
  quick_replies:       QuickReplyItem[];
  kind:                MessageKind;
  riddle_id:           string;
  puzzle_type:         string;
  answer:              string;
  tap_destination_id:  string;
  tap_url:             string;
}

function buildPreviewChain(args: {
  messageId:   string | undefined;
  form:        MessageFormState;
  allMessages: {
    id: string;
    body: string | null;
    kind: string;
    quick_replies?: QuickReplyItem[] | null;
    next_message_id?: string | null;
    message_type?: string;
    asset_url?: string | null;
    free_input_enabled?: boolean;
  }[];
}): ChainPreviewItem[] {
  const { messageId, form, allMessages } = args;

  // ── 上流側 (= 編集中メッセージを next_message_id で指している親メッセージ列) を辿る ──
  // 終了条件: 親が見つからない / 循環検出 / 上限到達 のいずれか。
  const upstream: typeof allMessages = [];
  if (messageId) {
    const byNext = new Map<string, typeof allMessages[number]>();
    for (const m of allMessages) {
      if (m.next_message_id) byNext.set(m.next_message_id, m);
    }
    const visited = new Set<string>();
    let cursor: string | undefined = messageId;
    while (cursor && !visited.has(cursor) && upstream.length < PREVIEW_CHAIN_MAX) {
      visited.add(cursor);
      const parent = byNext.get(cursor);
      if (!parent) break;
      upstream.unshift(parent); // head 方向に積む
      cursor = parent.id;
    }
  }

  const out: ChainPreviewItem[] = [];

  // 1. 上流 (= 親側)。API スナップショットそのまま。
  //    free_input_enabled の親で chain は切れる (= 実送信仕様に揃える)。
  for (const m of upstream) {
    out.push({
      key:                `up:${m.id}`,
      message_type:       (m.message_type as ExtendedMessageType) ?? "text",
      body:               m.body ?? "",
      asset_url:          m.asset_url ?? "",
      notify_text:        "",
      carousel_items:     [],
      character_id:       "",
      quick_replies:      m.quick_replies ?? [],
      kind:               (m.kind as MessageKind) ?? "normal",
      riddle_id:          "",
      puzzle_type:        "",
      answer:             "",
      tap_destination_id: "",
      tap_url:            "",
    });
    if (m.free_input_enabled) return out;
    if (out.length >= PREVIEW_CHAIN_MAX) return out;
  }

  // 2. 編集中メッセージ (= form 本体 = live edit を反映)。
  //    新規でも head として扱い、1 通目相当の bubble として描画する。
  out.push({
    key:                messageId ? `cur:${messageId}` : "cur:new",
    message_type:       form.message_type,
    body:               form.body,
    asset_url:          form.asset_url,
    notify_text:        form.notify_text,
    carousel_items:     form.carousel_items,
    character_id:       form.character_id,
    quick_replies:      form.quick_replies,
    kind:               form.kind,
    riddle_id:          form.riddle_id,
    puzzle_type:        form.puzzle_type,
    answer:             form.answer,
    tap_destination_id: form.tap_destination_id,
    tap_url:            form.tap_url,
  });
  if (form.free_input_enabled) return out;
  if (out.length >= PREVIEW_CHAIN_MAX) return out;

  // 3. form.additionalMessages (= 編集中の 2 通目以降。live edit を反映)。
  //    AdditionalMessageSlot には quick_replies フィールドが無いため、
  //    保存済 slot は existingId をキーに allMessages から QR を引き当てる
  //    (= 実 DB 値)。新規追加 slot (existingId なし) は QR 未保存なので空配列。
  const byId = new Map(allMessages.map((m) => [m.id, m]));
  for (let i = 0; i < form.additionalMessages.length; i++) {
    const s = form.additionalMessages[i];
    const dbRow = s.existingId ? byId.get(s.existingId) : undefined;
    out.push({
      key:                s.existingId ? `add:${s.existingId}` : `add-new:${i}`,
      message_type:       s.message_type,
      body:               s.body,
      asset_url:          s.asset_url,
      notify_text:        s.notify_text,
      carousel_items:     s.carousel_items,
      // 空文字なら親 form の character を引き継ぐ (= AdditionalMessageBlock の UI 仕様と一致)。
      character_id:       s.character_id || form.character_id,
      quick_replies:      dbRow?.quick_replies ?? [],
      // continuation は通常 kind=normal / puzzle 系フィールドは無い。
      kind:               "normal",
      riddle_id:          "",
      puzzle_type:        "",
      answer:             "",
      tap_destination_id: "",
      tap_url:            "",
    });
    if (s.free_input_enabled) return out;
    if (out.length >= PREVIEW_CHAIN_MAX) return out;
  }

  return out;
}

// ────────────────────────────────────────────────────────

function AdditionalMessageBlock({
  index, slot, onChange, onRemove, onDetach, canDetach, onMoveUp, onMoveDown, canMoveUp, canMoveDown, oaId, workId, characters, allMessages,
}: {
  index:      number;
  slot:       AdditionalMessageSlot;
  onChange:   (slot: AdditionalMessageSlot) => void;
  onRemove:   () => void;
  /** chain から外す（#6-4c・非破壊）。保存済みスロット（existingId あり）でのみ有効。 */
  onDetach?:    () => void;
  canDetach?:   boolean;
  /** 上下移動（#6-3）。freeInput プロンプトは末尾固定のため両方 disabled になる。 */
  onMoveUp?:    () => void;
  onMoveDown?:  () => void;
  canMoveUp?:   boolean;
  canMoveDown?: boolean;
  oaId:       string;
  workId:     string;
  characters: Character[];
  /** free_input_next_message_id の選択肢用。chain head と continuation 両方を含む全 message。 */
  allMessages: {
    id: string; body: string | null; kind: string; sort_order: number;
    phase_id?: string | null; quick_replies?: QuickReplyItem[] | null;
    trigger_keyword?: string | null;
  }[];
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertAtCursor(placeholder: string) {
    const el = bodyRef.current;
    if (!el) { onChange({ ...slot, body: slot.body + placeholder }); return; }
    const start = el.selectionStart ?? slot.body.length;
    const end   = el.selectionEnd   ?? slot.body.length;
    const next  = slot.body.slice(0, start) + placeholder + slot.body.slice(end);
    onChange({ ...slot, body: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + placeholder.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const mtype = slot.message_type;

  return (
    <div style={{
      border: "1px solid #e5e7eb", borderRadius: 10, background: "#fafafa",
      marginTop: 12, overflow: "hidden",
    }}>
      {/* ヘッダー */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
          {index + 2}通目のメッセージ{slot.free_input_enabled ? "（自由入力・末尾固定）" : ""}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* 上下移動（#6-3）。freeInput プロンプトは末尾固定のため無効。 */}
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="上へ移動"
            aria-label="上へ移動"
            style={{
              fontSize: 12, padding: "2px 8px", border: "1px solid #d1d5db", borderRadius: 6,
              background: canMoveUp ? "#fff" : "#f3f4f6", color: canMoveUp ? "#374151" : "#cbd5e1",
              cursor: canMoveUp ? "pointer" : "not-allowed",
            }}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="下へ移動"
            aria-label="下へ移動"
            style={{
              fontSize: 12, padding: "2px 8px", border: "1px solid #d1d5db", borderRadius: 6,
              background: canMoveDown ? "#fff" : "#f3f4f6", color: canMoveDown ? "#374151" : "#cbd5e1",
              cursor: canMoveDown ? "pointer" : "not-allowed",
            }}
          >
            ↓
          </button>
          {canDetach && (
            <button
              type="button"
              onClick={onDetach}
              title="このメッセージは削除されません。連続メッセージから外れ、単体メッセージとして残ります。"
              style={{
                fontSize: 11, padding: "2px 10px", border: "1px solid #cbd5e1",
                borderRadius: 6, background: "#fff", color: "#475569", cursor: "pointer",
              }}
            >
              chainから外す
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            title="このメッセージを削除します。参照されている場合は削除できません。"
            style={{
              fontSize: 11, padding: "2px 10px", border: "1px solid #fecaca",
              borderRadius: 6, background: "#fff5f5", color: "#ef4444", cursor: "pointer",
            }}
          >
            削除
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 14px" }}>
        {/* 発話キャラクター */}
        <div className="form-group">
          <label style={fieldLabel}>発話キャラクター</label>
          <select
            className="form-input"
            value={slot.character_id}
            onChange={(e) => onChange({ ...slot, character_id: e.target.value })}
          >
            <option value="">— 1通目のキャラクターを引き継ぐ —</option>
            {characters.map((ch) => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
        </div>

        {/* 種別選択 */}
        <div className="form-group">
          <label style={fieldLabel}>種別</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {MESSAGE_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...slot, message_type: opt.value, body: "", asset_url: "", carousel_items: [] })}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  gap: 3, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                  fontSize: 11, fontWeight: 500, transition: "all 0.15s", minWidth: 64,
                  border: mtype === opt.value ? "2px solid #06C755" : "2px solid #e5e5e5",
                  background: mtype === opt.value ? "#E6F7ED" : "#fff",
                  color: mtype === opt.value ? "#06C755" : "#6b7280",
                }}
              >
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* テキスト */}
        {mtype === "text" && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={fieldLabel}>本文</label>
            <textarea
              ref={bodyRef}
              className="form-input"
              style={{ minHeight: 80, resize: "vertical" }}
              value={slot.body}
              onChange={(e) => onChange({ ...slot, body: e.target.value })}
              placeholder="送信するテキストを入力してください"
              maxLength={5000}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { label: "友だちの表示名", placeholder: "{{user_name}}" },
                  { label: "アカウント名",   placeholder: "{{account_name}}" },
                ].map(({ label, placeholder }) => (
                  <button
                    key={placeholder}
                    type="button"
                    onClick={() => insertAtCursor(placeholder)}
                    style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 20,
                      border: "1px solid #06C755", background: "#E6F7ED",
                      color: "#059669", cursor: "pointer", fontWeight: 500,
                    }}
                  >
                    + {label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{slot.body.length} / 5000</span>
            </div>
          </div>
        )}

        {/* 画像 */}
        {mtype === "image" && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={fieldLabel}>画像</label>
            <ImageUploader
              value={slot.asset_url}
              onChange={(url) => onChange({ ...slot, asset_url: url })}
              oaId={oaId}
              workId={workId}
            />
          </div>
        )}

        {/* 動画 */}
        {mtype === "video" && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={fieldLabel}>動画 URL</label>
            <input
              type="url"
              className="form-input"
              value={slot.asset_url}
              onChange={(e) => onChange({ ...slot, asset_url: e.target.value })}
              placeholder="https://example.com/video.mp4"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
          </div>
        )}

        {/* ボイス */}
        {mtype === "voice" && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={fieldLabel}>音声ファイル URL</label>
            <input
              type="url"
              className="form-input"
              value={slot.asset_url}
              onChange={(e) => onChange({ ...slot, asset_url: e.target.value })}
              placeholder="https://example.com/audio.m4a"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
          </div>
        )}

        {/* カルーセル */}
        {mtype === "carousel" && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={fieldLabel}>
              カード
              <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                ({slot.carousel_items.length} / 10枚)
              </span>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {slot.carousel_items.map((card, ci) => (
                <div key={ci} style={{ padding: "10px 12px", border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>カード {ci + 1}</span>
                    <button type="button" className="btn btn-ghost"
                      style={{ padding: "1px 6px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }}
                      onClick={() => onChange({ ...slot, carousel_items: slot.carousel_items.filter((_, ii) => ii !== ci) })}>
                      削除
                    </button>
                  </div>
                  {(["title", "body", "button_label"] as const).map((field) => (
                    <div key={field} className="form-group" style={{ marginBottom: 6 }}>
                      <label style={{ ...fieldLabel, fontSize: 11 }}>
                        {field === "title" ? "タイトル" : field === "body" ? "本文（任意）" : "ボタンラベル（任意）"}
                      </label>
                      {field === "body" ? (
                        <textarea className="form-input" rows={2}
                          style={{ fontSize: 12, resize: "vertical" }}
                          value={card[field]}
                          onChange={(e) => {
                            const updated = slot.carousel_items.map((c, ii) => ii === ci ? { ...c, [field]: e.target.value } : c);
                            onChange({ ...slot, carousel_items: updated });
                          }} />
                      ) : (
                        <input type="text" className="form-input" style={{ fontSize: 12 }}
                          value={card[field]}
                          onChange={(e) => {
                            const updated = slot.carousel_items.map((c, ii) => ii === ci ? { ...c, [field]: e.target.value } : c);
                            onChange({ ...slot, carousel_items: updated });
                          }} />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {slot.carousel_items.length < 10 && (
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={() => onChange({ ...slot, carousel_items: [...slot.carousel_items, { ...EMPTY_CAROUSEL_CARD }] })}>
                ＋ カードを追加
              </button>
            )}
          </div>
        )}

        {/* Flex Message（1通目と同じ入力 UI） */}
        {mtype === "flex" && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            {/* A. Simulator への外部リンク */}
            <div style={{ marginBottom: 14 }}>
              <a
                href={FLEX_SIMULATOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 6, border: "1px solid #06C755",
                  color: "#06C755", fontSize: 12, fontWeight: 600, textDecoration: "none",
                }}
              >
                Flex Message Simulatorを開く ↗
              </a>
              <div style={{ ...hintText, marginTop: 6 }}>
                SimulatorでFlex Messageを作成し、右上の「View as JSON」からJSONをコピーして貼り付けてください。
              </div>
            </div>

            {/* B. 代替テキスト */}
            <label style={fieldLabel}>
              代替テキスト <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <input
              type="text"
              className="form-input"
              maxLength={400}
              value={slot.alt_text}
              onChange={(e) => onChange({ ...slot, alt_text: e.target.value })}
              placeholder="Flex Message"
            />
            <div style={hintText}>通知や未対応端末で表示されるテキストです。</div>

            {/* C. Flex Message JSON */}
            <label style={{ ...fieldLabel, marginTop: 14 }}>
              Flex Message JSON <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={() => onChange({ ...slot, flex_payload_json: FLEX_SAMPLE_JSON })}
              >
                サンプルを挿入
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={() => onChange({ ...slot, flex_payload_json: prettyFlexJson(slot.flex_payload_json) })}
              >
                JSONを整形
              </button>
            </div>
            <textarea
              value={slot.flex_payload_json}
              onChange={(e) => onChange({ ...slot, flex_payload_json: e.target.value })}
              rows={14}
              spellCheck={false}
              style={{
                width: "100%",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12, lineHeight: 1.5, padding: 10,
                border: "1px solid #d1d5db", borderRadius: 6, resize: "vertical",
              }}
              placeholder={FLEX_JSON_PLACEHOLDER}
            />
            <div style={hintText}>
              Flex Message SimulatorからコピーしたJSONを貼り付けてください。contentsだけ・flex全体のどちらでも保存できます。
            </div>
            {slot.flex_payload_json.trim() && (() => {
              const r = normalizeFlexJson(slot.flex_payload_json);
              return r.ok ? null : (
                <div style={{ marginTop: 6, color: "#dc2626", fontSize: 12, lineHeight: 1.5 }}>
                  {r.error}
                </div>
              );
            })()}
          </div>
        )}

        {/* 通知メッセージ（テキスト以外。flex は不要） */}
        {mtype !== "text" && mtype !== "riddle" && mtype !== "flex" && (
          <div className="form-group" style={{ marginTop: 10 }}>
            <label style={fieldLabel}>通知メッセージ（任意）</label>
            <input
              type="text"
              className="form-input"
              value={slot.notify_text}
              onChange={(e) => onChange({ ...slot, notify_text: e.target.value })}
              placeholder="例: メッセージが届きました"
              maxLength={200}
            />
          </div>
        )}

        {/* 前のメッセージからの待機時間（2通目以降の lag_ms） */}
        <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
          <label style={fieldLabel}>前のメッセージからの待機時間</label>
          <DurationInput
            valueMs={slot.lag_ms ?? 0}
            onChange={(ms) => onChange({ ...slot, lag_ms: ms })}
            />
          <div style={hintText}>前の吹き出しを送ったあと、このメッセージを送る前に待つ時間です</div>
        </div>

        {/* 演出設定 (既読 / typing / loading) — 折りたたみ。
            1 通目 form と同じ TimingConfigSection を generic 化して再利用。 */}
        <TimingConfigSection
          form={slot}
          set={(k, v) => onChange({ ...slot, [k]: v })}
          isAdditional
        />

        {/* 自由入力受付 (= chain continuation でも freeInput プロンプトに設定可能)。
            1 通目と同形。example: 「{{user_name}}さんにより画像がタップされました」
            (chain head, freeInput=false) → 「xxについてどう思う？」(slot, freeInput=true)
            の構成で、slot が freeInput プロンプトとして waitingForInput をセットする。 */}
        <SectionAccordion
          title="この追加メッセージ送信後に自由入力を受け付ける"
          optional
          description="この追加メッセージを送信した直後に、ユーザーの次の入力を変数として保存します。"
          defaultOpen={slot.free_input_enabled}
        >
          {/* 使い分けの案内 (= 1通目の直後 vs 2通目以降の直後) */}
          <div style={{
            fontSize: 12, lineHeight: 1.6, padding: "10px 12px", marginBottom: 12,
            background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, color: "#075985",
          }}>
            「どのメッセージの直後に入力を待つか」で設定場所を選びます。
            <br />
            1通目の直後に待つ場合は <strong>メインメッセージ側</strong>、
            2通目以降の直後に待つ場合は <strong>該当する追加メッセージ側</strong> (このセクション) で ON にしてください。
          </div>
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={slot.free_input_enabled}
                onChange={(e) => onChange({ ...slot, free_input_enabled: e.target.checked })}
              />
              <span style={{ fontSize: 14, fontWeight: 600 }}>この追加メッセージ送信後に自由入力を受け付ける</span>
            </label>
            <div style={{ ...hintText, marginTop: 4 }}>
              この追加メッセージを送信した直後に、ユーザーの次の入力を変数として保存します。
              <br />
              チェーン途中で質問を挟みたい場合に使います (= 1 通目はそのまま送信、
              この追加メッセージで入力待機になる)。
            </div>
          </div>

          {slot.free_input_enabled && (
            <>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label style={fieldLabel} htmlFor={`slot-${index}-free_input_variable_key`}>
                  保存する変数名
                  <span style={{ fontSize: 10, fontWeight: 700, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
                </label>
                <input
                  id={`slot-${index}-free_input_variable_key`}
                  type="text"
                  className="form-input"
                  style={{ maxWidth: 320 }}
                  value={slot.free_input_variable_key}
                  onChange={(e) => onChange({ ...slot, free_input_variable_key: e.target.value })}
                  placeholder="例: userName（差し込みが不要なら空欄でOK）"
                  maxLength={60}
                  autoComplete="off"
                />
                {(() => {
                  const v = slot.free_input_variable_key.trim();
                  const validRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
                  if (v && !validRegex.test(v)) {
                    return (
                      <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>
                        変数名は半角英数字とアンダースコアで入力してください。先頭に数字は使えません。
                      </div>
                    );
                  }
                  return (
                    <div style={hintText}>
                      入力内容を次のメッセージで使いたい場合のみ設定します。空欄なら入力を受け付けるだけ。
                    </div>
                  );
                })()}
              </div>

              <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
                <label style={fieldLabel} htmlFor={`slot-${index}-free_input_next_message_id`}>
                  入力後に送信するメッセージ
                </label>
                <select
                  id={`slot-${index}-free_input_next_message_id`}
                  className="form-input"
                  value={slot.free_input_next_message_id}
                  onChange={(e) => onChange({ ...slot, free_input_next_message_id: e.target.value })}
                >
                  <option value="">— 選択しない（次メッセージを送らない）—</option>
                  {allMessages
                    .filter((m) => m.id !== slot.existingId)
                    .map((m) => {
                      const label = m.body?.trim().slice(0, 30) || `(本文なし) id=${m.id.slice(0, 8)}`;
                      return (
                        <option key={m.id} value={m.id}>{label}</option>
                      );
                    })}
                </select>
                <div style={hintText}>
                  ユーザー入力を受け取った後に送信するメッセージ。
                  {slot.free_input_variable_key.trim() ? (
                    <>本文に <code>{`{${slot.free_input_variable_key.trim()}}`}</code> と書くと、保存した値が差し込まれます。</>
                  ) : (
                    <>変数名を設定していないため、ここでは入力内容を差し込みません（受け取って次へ進むだけ）。</>
                  )}
                </div>
              </div>
            </>
          )}
        </SectionAccordion>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// SectionAccordion — 開閉できるセクションラッパー
// ────────────────────────────────────────────────────────

function SectionAccordion({
  title, required, optional, description, defaultOpen = true, badge, children,
}: {
  title: string;
  /** 必須セクション (= 「必須」バッジ表示) */
  required?: boolean;
  /** 任意セクション (= 「任意」バッジ表示、required と排他扱い) */
  optional?: boolean;
  /** header 下に表示する短い helper text。長い文章は入れない。 */
  description?: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: 0, textAlign: "left",
          marginBottom: open ? 12 : 0,
          paddingBottom: open ? 6 : 0,
          borderBottom: open ? "1px solid #e5e5e5" : "none",
        }}
        aria-expanded={open}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: "#374151" }}>{title}</span>
            {required && (
              <span style={{
                fontSize: 10, fontWeight: 700, background: "#fef2f2", color: "#dc2626",
                borderRadius: 4, padding: "1px 6px",
              }}>必須</span>
            )}
            {!required && optional && (
              <span style={{
                fontSize: 10, fontWeight: 700, background: "var(--color-line-2, #f0f3f1)", color: "var(--color-ink-3, #9aa8a2)",
                borderRadius: 4, padding: "1px 6px",
              }}>任意</span>
            )}
            {badge}
          </div>
          {description && (
            <span style={{
              fontSize: 11, color: "var(--color-ink-3, #9aa8a2)", lineHeight: 1.5, fontWeight: 400,
            }}>
              {description}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#9ca3af", userSelect: "none", flexShrink: 0, marginLeft: 8 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── メインコンポーネント ────────────────────────────────────

export function MessageForm({
  oaId, workId, workTitle, initialForm, isNew,
  submitting, deleting, onSubmit, onDelete, messageId,
}: MessageFormProps) {
  const [form, setForm]       = useState<MessageFormState>(initialForm);
  const [error, setError]     = useState<string | null>(null);
  const bodyTextareaRef       = useRef<HTMLTextAreaElement>(null);

  const isPuzzle = form.kind === "puzzle";
  const isSystemNotice = form.kind === "system_notice";

  const [phases, setPhases]         = useState<PhaseWithCounts[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [riddles, setRiddles]       = useState<Riddle[]>([]);
  const [allMessages, setAllMessages] = useState<{
    id: string; body: string | null; kind: string; sort_order: number;
    phase_id?: string | null; quick_replies?: QuickReplyItem[] | null;
    trigger_keyword?: string | null;
    // chain プレビュー用 (= 編集対象が継続側のとき親方向を辿る + 親側の表示)
    next_message_id?: string | null;
    message_type?: string;
    asset_url?: string | null;
    free_input_enabled?: boolean;
    // 既存メッセージ取り込み（PR3b）用
    work_id?: string | null;
    is_active?: boolean;
    created_at?: string | null;
    free_input_next_message_id?: string | null;
  }[]>([]);

  // ── 既存メッセージ取り込み（PR3b-2）──
  const [importPicker, setImportPicker] = useState<{ insertIndex: number; appendAtEnd: boolean } | null>(null);

  // ── destination 選択用 ──
  const [destinations, setDestinations] = useState<LineDestination[]>([]);
  const [tapMode, setTapMode] = useState<TapMode>(() =>
    detectTapMode(initialForm.tap_destination_id, initialForm.tap_url)
  );

  useEffect(() => {
    const token = getDevToken();
    // destination 一覧も並行取得
    destinationApi.list(token, workId).then(setDestinations).catch(() => {});
  }, [workId]);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      phaseApi.list(token, workId),
      characterApi.list(token, workId),
      riddleApi.list(token, oaId),
      messageApi.list(token, workId),
    ]).then(([ph, ch, rd, msgs]) => {
      setPhases(ph);
      setCharacters(ch);
      setRiddles(rd);
      setAllMessages(msgs.map((m) => ({
        id:                 m.id,
        body:               m.body,
        kind:               m.kind,
        sort_order:         m.sort_order,
        phase_id:           m.phase_id,
        quick_replies:      m.quick_replies,
        trigger_keyword:    m.trigger_keyword,
        next_message_id:    m.next_message_id,
        message_type:       m.message_type,
        asset_url:          m.asset_url,
        free_input_enabled: m.free_input_enabled,
        work_id:                    m.work_id,
        is_active:                  m.is_active,
        created_at:                 m.created_at,
        free_input_next_message_id: m.free_input_next_message_id,
      })));
    }).catch(() => {});
  }, [workId, oaId]);

  function set<K extends keyof MessageFormState>(k: K, v: MessageFormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // プレビュー用 chain (= 上流の親 + 編集中 form + form.additionalMessages を head→tail で並べたもの)。
  // 構築は純関数 buildPreviewChain に切り出し済。空配列なら PreviewPanel は head 1 通のみ描画する。
  const previewChain = buildPreviewChain({ messageId, form, allMessages });

  function insertAtCursor(placeholder: string) {
    const el = bodyTextareaRef.current;
    if (!el) {
      set("body", form.body + placeholder);
      return;
    }
    const start = el.selectionStart ?? form.body.length;
    const end   = el.selectionEnd   ?? form.body.length;
    const next  = form.body.slice(0, start) + placeholder + form.body.slice(end);
    set("body", next);
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  // ── カルーセルカード操作 ────────────────────────────────

  function addCard() {
    if (form.carousel_items.length >= 10) return;
    set("carousel_items", [...form.carousel_items, { ...EMPTY_CAROUSEL_CARD }]);
  }

  function updateCard(index: number, key: keyof MessageCarouselCard, value: string) {
    const updated = form.carousel_items.map((c, i) =>
      i === index ? { ...c, [key]: value } : c
    );
    set("carousel_items", updated);
  }

  function removeCard(index: number) {
    set("carousel_items", form.carousel_items.filter((_, i) => i !== index));
  }

  // ── 送信 ────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateMessageForm(form);
    if (err) { setError(err); return; }
    setError(null);

    // 応答メッセージの場合: QR連携ラベルを trigger_keyword にマージして保存
    let submitForm = form;
    if (form.kind === "response" && messageId) {
      const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
      const manual = form.trigger_keyword.split("\n").map((k) => k.trim()).filter(Boolean);
      const linked = allMessages
        .flatMap((m) => (m.quick_replies ?? []))
        .filter((qr) => qr.response_message_id === messageId && qr.label.trim())
        .map((qr) => qr.label.trim())
        .filter((l, i, arr) => arr.indexOf(l) === i) // dedup linked
        .filter((l) => !manual.some((e) => norm(e) === norm(l))); // exclude already-manual
      if (linked.length > 0) {
        submitForm = { ...form, trigger_keyword: [...manual, ...linked].join("\n") };
      }
    }

    onSubmit(submitForm);
  }

  // ── answer_match_type トグル ────────────────────────────

  /**
   * 照合条件（exact / partial）の切り替え。配列内のどちらか1つだけが有効。
   * 既存データに "exact" / "partial" が無い場合は "exact" を初期値とする。
   */
  function setMatchMode(mode: AnswerMatchMode) {
    const others = form.answer_match_type.filter(
      (x) => x !== "exact" && x !== "partial",
    );
    set("answer_match_type", [mode, ...others] as AnswerMatchType[]);
  }

  /** 正規化オプション（normalize_width / ignore_punctuation）のトグル */
  function toggleMatchOption(opt: "normalize_width" | "ignore_punctuation") {
    const current = form.answer_match_type;
    if (current.includes(opt)) {
      set("answer_match_type", current.filter((x) => x !== opt));
    } else {
      set("answer_match_type", [...current, opt]);
    }
  }

  /** 現在の照合条件（既存データに含まれない場合は "exact"） */
  const matchMode: AnswerMatchMode = form.answer_match_type.includes("partial")
    ? "partial"
    : "exact";

  // ── レンダリング ──────────────────────────────────────────

  const mtype = form.message_type;

  return (
    <>
      {/* ── レスポンシブ: 768px以下で縦並び ── */}
      <style>{`
        .msg-form-layout { display: flex; gap: 24px; align-items: flex-start; }
        .msg-form-col    { flex: 1; min-width: 0; padding-bottom: 80px; }
        .msg-preview-col {
          flex-shrink: 0; width: 340px;
          position: sticky; top: 24px;
          max-height: calc(100vh - 48px);
          overflow-y: auto;
        }

        /* ── 詳細設定 divider (= 「送信設定」 等の控えめなセクション前に置く視覚的区切り) ── */
        .msg-section-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 12px 0 4px;
          color: var(--color-ink-3, #9aa8a2);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
        }
        .msg-section-divider::before,
        .msg-section-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--color-line, #e8edea);
        }
        .msg-section-divider-hint {
          text-align: center;
          margin: 0 0 12px;
          font-size: 11px;
          line-height: 1.5;
          color: var(--color-ink-3, #9aa8a2);
        }

        /* ── 基本設定の冒頭に出す概要 info (= 初心者向けガイダンス) ── */
        .msg-basic-intro {
          margin: 0 0 16px;
          padding: 10px 14px;
          background: var(--color-bg-tint, #fafcfb);
          border: 1px solid var(--color-line, #e8edea);
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.6;
          color: var(--color-ink-2, #5f6b65);
        }
        .msg-basic-intro strong {
          color: var(--color-ink, #33403a);
          font-weight: 700;
        }

        /* ── 画面下に常時表示する action footer ── */
        /* 保存・キャンセル・削除を sticky で固定し、スクロール量に関わらず操作可能に。 */
        /* 親 (.msg-form-col) に padding-bottom を入れ、最後のフォーム項目と被らないようにする。 */
        .msg-action-footer {
          position: sticky;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 20;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          margin: 16px -16px 0;
          background: var(--color-surface, #ffffff);
          border-top: 1px solid var(--color-line, #e8edea);
          box-shadow: 0 -2px 8px rgba(26, 40, 32, 0.04);
        }
        .msg-action-footer .msg-action-group {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        @media (max-width: 768px) {
          .msg-form-layout  { flex-direction: column; }
          .msg-preview-col  { position: static; width: 100%; max-height: none; order: -1; }
          .msg-action-footer {
            margin: 16px 0 0;
            padding: 12px 14px;
          }
        }
      `}</style>

      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "メッセージ", href: `/oas/${oaId}/works/${workId}/messages` },
            { label: isNew ? "新規作成" : "編集" },
          ]} />
          <h2>{isNew ? "メッセージを追加" : "メッセージを編集"}</h2>
        </div>
      </div>

      {/* ── 2カラムレイアウト ── */}
      <div className="msg-form-layout">
        {/* ── 左カラム: フォーム ── */}
        <form
          onSubmit={handleSubmit}
          className="msg-form-col"
        >
          {/* エラーアラート */}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* ── 基本設定の概要 (= 初心者向けガイダンス、新規時のみ表示) ── */}
          {/* 既存メッセージの編集時はすでに何度か触っているはずなので、ノイズを減らすため非表示。 */}
          {isNew && (
            <p className="msg-basic-intro">
              <strong>基本設定</strong>だけ入力すれば登録できます。
              詳細な演出や任意項目は下の「詳細設定（任意）」エリアでまとめて調整できます。
            </p>
          )}

          {/* ════════════════════════════════════════
              カテゴリ選択: メッセージ / 謎
          ════════════════════════════════════════ */}
          <SectionAccordion
            title="メッセージタイプ"
            required
            description="通常のメッセージか、謎・問題かを選びます"
            defaultOpen={true}
          >
            <div style={{ display: "flex", gap: 12 }}>
              {([
                { value: "normal" as const, label: "メッセージを送る",  desc: "テキストや画像など、通常の会話メッセージ" },
                { value: "puzzle" as const, label: "謎・問題を出す", desc: "回答やヒントを含むインタラクティブなコンテンツ" },
              ] as const).map((cat) => {
                const isActive = cat.value === "puzzle" ? isPuzzle : !isPuzzle;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      if (cat.value === "puzzle" && !isPuzzle) {
                        set("kind", "puzzle");
                      } else if (cat.value === "normal" && isPuzzle) {
                        set("kind", "normal");
                      }
                    }}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "16px 12px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: isActive ? "2px solid #06C755" : "2px solid #e5e7eb",
                      background: isActive ? "#E6F7ED" : "#fff",
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? "#06C755" : "#374151" }}>
                      {cat.label}
                    </span>
                    <span style={{ fontSize: 11, color: isActive ? "#059669" : "#6b7280", textAlign: "center" }}>
                      {cat.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </SectionAccordion>

          {/* ════════════════════════════════════════
              セクション 1: トリガー設定
          ════════════════════════════════════════ */}
          <SectionAccordion
            title="トリガー設定"
            required
            description="どのタイミングでこのメッセージが送信されるかを設定します（キーワード・QR・遷移など）"
            defaultOpen={true}
          >

            {/* 送信タイミング（全種別共通） */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="msg_kind">
                送信タイミング
              </label>
              {isPuzzle ? (
                <div style={{
                  padding: "10px 14px",
                  background: "#f0f9ff",
                  border: "1px solid #bae6fd",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "#0369a1",
                  lineHeight: 1.7,
                }}>
                  🧩 <strong>謎・問題</strong>は、下で設定した<strong>フェーズに遷移したとき</strong>に自動で発火します。
                  フェーズを指定することで「いつ出すか」を制御できます。
                </div>
              ) : (
                <>
                  <select
                    id="msg_kind"
                    className="form-input"
                    value={form.kind}
                    onChange={(e) => {
                      const next = e.target.value as MessageKind;
                      set("kind", next);
                      // システム通知に切り替えたら message_type を text に強制
                      if (next === "system_notice") set("message_type", "text");
                    }}
                  >
                    <option value="normal">通常（フェーズ遷移時に送信）</option>
                    <option value="start">開始演出（startTrigger 一致時に送信）</option>
                    <option value="response">応答（trigger_keyword 一致時に返信）</option>
                    <option value="hint">ヒント（将来拡張）</option>
                    <option value="global">共通メッセージ（フェーズ不問・常時反応）</option>
                    <option value="system_notice">システム通知（中央表示・例: ミカさんが入室しました）</option>
                  </select>
                  <div style={hintText}>
                    {form.kind === "start"    && "開始フェーズの startTrigger が一致したとき送信されます。フェーズに kind=start のメッセージがない場合は通常メッセージにフォールバックします。"}
                    {form.kind === "response" && "trigger_keyword が一致したときのみ返信します。フェーズは進みません。"}
                    {form.kind === "normal"   && "フェーズ遷移時またはフェーズ表示時に送信されます。"}
                    {form.kind === "hint"     && "ヒント用メッセージです（将来拡張）。"}
                    {form.kind === "global"   && "どのフェーズにいても反応します（⭐ 全フェーズ共通）。ヒント・ヘルプ・やり直し案内などに使います。キーワードは必須です。"}
                    {form.kind === "system_notice" && "トーク中央に小さく表示されるシステム通知です（例: ミカさんが入室しました、通話が終了しました）。話者アイコン・名前は表示されません。LINE 上では通常テキストとして配信されます。"}
                  </div>
                  {form.kind === "global" && (
                    <div style={{
                      marginTop: 8,
                      padding: "8px 12px",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 6,
                      fontSize: 11,
                      color: "#166534",
                      lineHeight: 1.6,
                    }}>
                      💡 <strong>共通メッセージ</strong>：フェーズに依存しない返信です。
                      「応答キーワード」を必ず設定してください。フェーズ設定は自動的に無視されます。
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 応答キーワード（puzzle は不要） */}
            {!isPuzzle && (
            <div className="form-group">
              <label style={fieldLabel}>
                応答キーワード
                {(form.kind === "response" || form.kind === "global") && (
                  <span style={{ fontSize: 10, fontWeight: 700, background: "#fef2f2", color: "#dc2626", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>必須</span>
                )}
                {form.kind === "start" && (
                  <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>（kind=start では使用しません）</span>
                )}
              </label>
              <KeywordListEditor
                value={form.trigger_keyword}
                onChange={(v) => set("trigger_keyword", v)}
                disabled={form.kind === "start"}
                phases={phases}
                currentMessageId={messageId}
                allMessagesForLink={allMessages}
              />
              <div style={{ ...hintText, marginTop: 6 }}>
                {form.kind === "start"  && "kind=start では Phase.startTrigger を使います"}
                {form.kind === "global" && "どのフェーズでも反応します。キーワードは必須です。"}
                {form.kind !== "start" && form.kind !== "global" && "複数設定可。いずれかに一致したとき返信します（kind=response 推奨）"}
              </div>
            </div>
            )}

            {/* 送信対象セグメント */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="target_segment">
                送信対象セグメント
              </label>
              <select
                id="target_segment"
                className="form-input"
                value={form.target_segment}
                onChange={(e) => set("target_segment", e.target.value)}
              >
                <option value="">すべて</option>
                <option value="not_started">未開始</option>
                <option value="in_progress">進行中</option>
                <option value="completed">クリア済み</option>
              </select>
              {isPuzzle && (
                <div style={hintText}>
                  指定したセグメントのプレイヤーにのみ謎が発火します。「すべて」を選ぶと全員に適用されます。
                  通常は「すべて」または「進行中」を選択してください。
                </div>
              )}
            </div>

            {/* フェーズ（共通メッセージ時は非表示） */}
            {form.kind !== "global" && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="phase_id">
                フェーズ
                {isPuzzle && (
                  <span style={{ fontSize: 10, fontWeight: 700, background: "#fef2f2", color: "#dc2626", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>必須</span>
                )}
              </label>
              <select
                id="phase_id"
                className="form-input"
                value={form.phase_id}
                onChange={(e) => set("phase_id", e.target.value)}
              >
                <option value="">— フェーズを指定しない —</option>
                {phases.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name}
                  </option>
                ))}
              </select>
              {isPuzzle ? (
                <>
                  <div style={hintText}>
                    謎はフェーズに紐づくことで発火します。フェーズを指定しないと、この謎はどのフェーズでも発火しません。
                  </div>
                  {!form.phase_id && (
                    <div style={{
                      marginTop: 6,
                      padding: "8px 12px",
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      fontSize: 11,
                      color: "#dc2626",
                      lineHeight: 1.6,
                    }}>
                      フェーズが未設定です。このままでは謎が発火しません。必ずフェーズを選択してください。
                    </div>
                  )}
                </>
              ) : (
                <div style={hintText}>フェーズは必ず指定してください。全フェーズで反応させたい場合は「送信タイミング」→「共通メッセージ」を選択してください。</div>
              )}
            </div>
            )}

            {/* 表示順 (= 同条件のメッセージが複数あるときの並び順) */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="sort_order">
                表示順
              </label>
              <input
                id="sort_order"
                type="number"
                className="form-input"
                style={{ maxWidth: 120 }}
                value={form.sort_order}
                onChange={(e) => set("sort_order", Number(e.target.value))}
                min={0}
              />
              <div style={hintText}>同じ条件のメッセージが複数ある場合の並び順です（小さい順）</div>
            </div>
          </SectionAccordion>

          {/* ════════════════════════════════════════
              セクション 3a: 謎の形式とコンテンツ（puzzle のみ）
          ════════════════════════════════════════ */}
          {isPuzzle && (
          <SectionAccordion
            title="🧩 謎の形式"
            required
            description="クイズ形式かパスワード形式かなど、謎の出題方法を選びます"
            defaultOpen={true}
          >

            {/* ── 形式選択 ── */}
            <div className="form-group">
              <label style={fieldLabel}>形式</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PUZZLE_DELIVERY_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set("message_type", opt.value as ExtendedMessageType)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                      padding: "10px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                      transition: "all 0.15s",
                      minWidth: 72,
                      border: mtype === opt.value ? "2px solid #06C755" : "2px solid #e5e5e5",
                      background: mtype === opt.value ? "#E6F7ED" : "#fff",
                      color: mtype === opt.value ? "#06C755" : "#6b7280",
                    }}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── テキスト ── */}
            {mtype === "text" && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={fieldLabel} htmlFor="puzzle_body">
                  本文 <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  id="puzzle_body"
                  className="form-input"
                  style={{ minHeight: 100, resize: "vertical" }}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder="謎の問題文を入力してください"
                  maxLength={5000}
                />
                <div style={{ ...hintText, textAlign: "right" }}>
                  {form.body.length} / 5000
                </div>
              </div>
            )}

            {/* ── 画像 ── */}
            {mtype === "image" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel}>
                    画像 <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <ImageUploader
                    value={form.asset_url}
                    onChange={(url) => set("asset_url", url)}
                    oaId={oaId}
                    workId={workId}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="puzzle_notify_image">通知メッセージ（任意）</label>
                  <input id="puzzle_notify_image" type="text" className="form-input" value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)} placeholder="例: 謎が届きました" maxLength={200} />
                </div>
              </>
            )}

            {/* ── 動画 ── */}
            {mtype === "video" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="puzzle_asset_url_video">
                    動画 URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="puzzle_asset_url_video"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/puzzle.mp4"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="puzzle_notify_video">通知メッセージ（任意）</label>
                  <input id="puzzle_notify_video" type="text" className="form-input" value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)} placeholder="例: 謎が届きました" maxLength={200} />
                </div>
              </>
            )}

            {/* ── カルーセル ── */}
            {mtype === "carousel" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel}>
                    カード <span style={{ color: "#dc2626" }}>*</span>
                    <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                      ({form.carousel_items.length} / 10枚)
                    </span>
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    {form.carousel_items.map((card, index) => (
                      <div key={index} style={{ padding: "14px 16px", border: "1px solid #e5e5e5", borderRadius: 8, background: "#fafafa" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>カード {index + 1}</span>
                          <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }} onClick={() => removeCard(index)}>削除</button>
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>タイトル</label>
                          <input type="text" className="form-input" value={card.title} onChange={(e) => updateCard(index, "title", e.target.value)} placeholder="カードのタイトル" maxLength={100} style={{ fontSize: 13 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>本文（任意）</label>
                          <textarea className="form-input" value={card.body} onChange={(e) => updateCard(index, "body", e.target.value)} placeholder="カードの説明文" maxLength={500} rows={2} style={{ fontSize: 13, resize: "vertical" }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>画像 URL（任意）</label>
                          <input type="url" className="form-input" value={card.image_url} onChange={(e) => updateCard(index, "image_url", e.target.value)} placeholder="https://example.com/image.png" style={{ fontFamily: "monospace", fontSize: 12 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>ボタンラベル（任意）</label>
                          <input type="text" className="form-input" value={card.button_label} onChange={(e) => updateCard(index, "button_label", e.target.value)} placeholder="例: 詳しく見る" maxLength={50} style={{ fontSize: 13 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>ボタン URL（任意）</label>
                          <input type="url" className="form-input" value={card.button_url} onChange={(e) => updateCard(index, "button_url", e.target.value)} placeholder="https://example.com/" style={{ fontFamily: "monospace", fontSize: 12 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {form.carousel_items.length < 10 && (
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 14px" }} onClick={addCard}>
                      ＋ カードを追加
                    </button>
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="puzzle_notify_carousel">通知メッセージ（任意）</label>
                  <input id="puzzle_notify_carousel" type="text" className="form-input" value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)} placeholder="例: 謎が届きました" maxLength={200} />
                </div>
              </>
            )}
          </SectionAccordion>
          )} {/* /isPuzzle section 3a (形式+コンテンツ) */}

          {/* ════════════════════════════════════════
              セクション 3b: 送信メッセージ（puzzle のときは非表示）
          ════════════════════════════════════════ */}
          {!isPuzzle && (
          <SectionAccordion
            title="会話シーケンス"
            required
            description="謎を出題する流れ（出題メッセージ・ヒント・正解時のリアクションなど）"
            defaultOpen={true}
          >
            {/* === 1通目の発話 === */}
            <div style={{
              border: "1px solid #d1fae5", borderRadius: 10, background: "#f0fdf4",
              marginBottom: 12, overflow: "hidden",
            }}>
              {/* 発話ヘッダー */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px", background: "#dcfce7", borderBottom: "1px solid #d1fae5",
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#15803d" }}>1通目の発話</span>
              </div>

              <div style={{ padding: "12px 14px" }}>
                {/* 発話キャラクター（1通目） */}
                <div className="form-group">
                  <label style={fieldLabel}>発話キャラクター</label>
                  <select
                    className="form-input"
                    value={form.character_id}
                    onChange={(e) => set("character_id", e.target.value)}
                  >
                    <option value="">— キャラクターを指定しない —</option>
                    {characters.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                </div>

            {/* 種別選択 */}
            <div className="form-group">
              <label style={fieldLabel}>種別</label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {MESSAGE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set("message_type", opt.value)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                      padding: "10px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                      transition: "all 0.15s",
                      minWidth: 72,
                      border: mtype === opt.value
                        ? "2px solid #06C755"
                        : "2px solid #e5e5e5",
                      background: mtype === opt.value ? "#E6F7ED" : "#fff",
                      color: mtype === opt.value ? "#06C755" : "#6b7280",
                    }}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Flex Message ── */}
            {mtype === "flex" && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                {/* A. Simulator への外部リンク */}
                <div style={{ marginBottom: 14 }}>
                  <a
                    href={FLEX_SIMULATOR_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 14px", borderRadius: 6, border: "1px solid #06C755",
                      color: "#06C755", fontSize: 12, fontWeight: 600, textDecoration: "none",
                    }}
                  >
                    Flex Message Simulatorを開く ↗
                  </a>
                  <div style={{ ...hintText, marginTop: 6 }}>
                    SimulatorでFlex Messageを作成し、右上の「View as JSON」からJSONをコピーして貼り付けてください。
                  </div>
                </div>

                {/* B. 代替テキスト (altText) */}
                <label style={fieldLabel} htmlFor="flex_alt_text">
                  代替テキスト <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input
                  id="flex_alt_text"
                  type="text"
                  className="form-input"
                  maxLength={400}
                  value={form.alt_text}
                  onChange={(e) => set("alt_text", e.target.value)}
                  placeholder="Flex Message"
                />
                <div style={hintText}>通知や未対応端末で表示されるテキストです。</div>

                {/* C. Flex Message JSON */}
                <label style={{ ...fieldLabel, marginTop: 14 }} htmlFor="flex_json">
                  Flex Message JSON <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px" }}
                    onClick={() => set("flex_payload_json", FLEX_SAMPLE_JSON)}
                  >
                    サンプルを挿入
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px" }}
                    onClick={() => set("flex_payload_json", prettyFlexJson(form.flex_payload_json))}
                  >
                    JSONを整形
                  </button>
                </div>
                <textarea
                  id="flex_json"
                  value={form.flex_payload_json}
                  onChange={(e) => set("flex_payload_json", e.target.value)}
                  rows={14}
                  spellCheck={false}
                  style={{
                    width: "100%",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: 12, lineHeight: 1.5, padding: 10,
                    border: "1px solid #d1d5db", borderRadius: 6, resize: "vertical",
                  }}
                  placeholder={FLEX_JSON_PLACEHOLDER}
                />
                <div style={hintText}>
                  Flex Message SimulatorからコピーしたJSONを貼り付けてください。contentsだけ・flex全体のどちらでも保存できます。
                </div>
                {/* インライン検証エラー (入力がある場合のみ) */}
                {form.flex_payload_json.trim() && (() => {
                  const r = normalizeFlexJson(form.flex_payload_json);
                  return r.ok ? null : (
                    <div style={{ marginTop: 6, color: "#dc2626", fontSize: 12, lineHeight: 1.5 }}>
                      {r.error}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── テキスト ── */}
            {mtype === "text" && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={fieldLabel} htmlFor="body">
                  {isSystemNotice ? "表示テキスト" : "本文"} <span style={{ color: "#dc2626" }}>*</span>
                </label>
                {isSystemNotice && (
                  <div style={{
                    marginBottom: 8,
                    padding: "8px 12px",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    fontSize: 11,
                    color: "#6b7280",
                    lineHeight: 1.6,
                  }}>
                    💬 <strong>システム通知</strong>はトーク中央に小さく表示されます。
                    例: <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 3 }}>ミカさんが入室しました</code> /
                    <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 3, marginLeft: 4 }}>通話が終了しました</code>
                    <br />
                    話者キャラクター・応答キーワード・クイックリプライは無視されます。
                    LINE 上では通常テキストとして配信されます（中央寄せはプレビューのみ）。
                  </div>
                )}
                <textarea
                  ref={bodyTextareaRef}
                  id="body"
                  className="form-input"
                  style={{ minHeight: isSystemNotice ? 60 : 100, resize: "vertical" }}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder={isSystemNotice ? "例: ミカさんが入室しました" : "送信するテキストを入力してください"}
                  maxLength={5000}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[
                      { label: "友だちの表示名", placeholder: "{{user_name}}" },
                      { label: "アカウント名",   placeholder: "{{account_name}}" },
                    ].map(({ label, placeholder }) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() => insertAtCursor(placeholder)}
                        style={{
                          fontSize: 12, padding: "2px 10px", borderRadius: 20,
                          border: "1px solid #06C755", background: "#E6F7ED",
                          color: "#059669", cursor: "pointer", fontWeight: 500,
                        }}
                      >
                        + {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ ...hintText }}>{form.body.length} / 5000</div>
                </div>
              </div>
            )}

            {/* ── 画像 ── */}
            {mtype === "image" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel}>
                    画像 <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <ImageUploader
                    value={form.asset_url}
                    onChange={(url) => set("asset_url", url)}
                    oaId={oaId}
                    workId={workId}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_image">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_image"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: 画像が届きました"
                    maxLength={200}
                  />
                </div>
                {/* ── 画像タップ時の遷移先 (旧 Destination 経路 — 既存機能、互換のため残置) ── */}
                <div className="form-group" style={{ marginTop: 12 }}>
                  <TapDestinationSection
                    label="画像タップ時の遷移先"
                    workId={workId}
                    oaId={oaId}
                    mode={tapMode}
                    destinationId={form.tap_destination_id || null}
                    directUrl={form.tap_url}
                    destinations={destinations}
                    onModeChange={(m) => {
                      setTapMode(m);
                      if (m === "destination") set("tap_url", "");
                      if (m === "direct_url") set("tap_destination_id", "");
                      if (m === "none") { set("tap_destination_id", ""); set("tap_url", ""); }
                    }}
                    onDestinationChange={(id) => set("tap_destination_id", id ?? "")}
                    onDirectUrlChange={(url) => set("tap_url", url)}
                  />
                </div>

                {/* ── 画像メッセージ用: altText + タップ時アクション (Flex 変換用) ── */}
                <div className="form-group" style={{ marginTop: 16, borderTop: "1px dashed #e5e7eb", paddingTop: 12 }}>
                  <label style={fieldLabel} htmlFor="alt_text">
                    altText（プッシュ通知 / プレビュー用テキスト）
                    <span style={{ fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
                  </label>
                  <input
                    id="alt_text"
                    type="text"
                    className="form-input"
                    value={form.alt_text}
                    onChange={(e) => set("alt_text", e.target.value)}
                    placeholder="例: 古い写真（既定: 画像メッセージ）"
                    maxLength={400}
                  />
                  <div style={hintText}>
                    タップ時アクション設定時に Flex Message として送信されるため altText が必須になります。未入力なら「画像メッセージ」が使われます。
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: 12 }}>
                  <label style={fieldLabel} htmlFor="image_action_type">
                    タップ時の動作
                    <span style={{ fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
                  </label>
                  <select
                    id="image_action_type"
                    className="form-input"
                    value={form.image_action_type}
                    onChange={(e) => set("image_action_type", e.target.value as MessageFormState["image_action_type"])}
                    style={{ maxWidth: 320 }}
                  >
                    <option value="">なし（通常の画像メッセージとして送信）</option>
                    <option value="message">メッセージを送信する</option>
                    <option value="uri">URL を開く</option>
                    <option value="liff" disabled>LIFF ページを開く（実装予定）</option>
                    <option value="postback" disabled>内部イベントを発火する（実装予定）</option>
                  </select>
                  <div style={hintText}>
                    アクションを設定すると、画像が LINE 上で Flex Message として送信され、タップ可能になります。
                  </div>
                </div>

                {form.image_action_type === "message" && (
                  <div className="form-group" style={{ marginTop: 12, marginLeft: 24, paddingLeft: 12, borderLeft: "3px solid #e5e7eb" }}>
                    <label style={fieldLabel} htmlFor="image_action_text">
                      送信されるテキスト <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      id="image_action_text"
                      type="text"
                      className="form-input"
                      value={form.image_action_text}
                      onChange={(e) => set("image_action_text", e.target.value)}
                      placeholder="例: 古い写真を見る"
                      maxLength={300}
                    />
                    <div style={hintText}>
                      プレイヤーが画像をタップすると、このテキストがプレイヤーから送信されたものとして扱われます。
                      <br />既存の応答キーワードに設定すると、次のメッセージを送信できます。
                    </div>
                  </div>
                )}

                {form.image_action_type === "uri" && (
                  <div className="form-group" style={{ marginTop: 12, marginLeft: 24, paddingLeft: 12, borderLeft: "3px solid #e5e7eb" }}>
                    <label style={fieldLabel} htmlFor="image_action_url">
                      開く URL <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <input
                      id="image_action_url"
                      type="url"
                      className="form-input"
                      value={form.image_action_url}
                      onChange={(e) => set("image_action_url", e.target.value)}
                      placeholder="https://example.com/"
                      style={{ fontFamily: "monospace", fontSize: 13 }}
                      maxLength={2000}
                    />
                    <div style={hintText}>https:// のみ対応。タップで外部ブラウザが開きます。</div>
                  </div>
                )}

                {/* ── プレビュー (タップ時の挙動サマリ) ── */}
                {form.image_action_type && (
                  <div style={{
                    marginTop: 12, padding: "10px 12px",
                    background: "#f0f9ff", border: "1px solid #bae6fd",
                    borderRadius: 8, fontSize: 12, color: "#0c4a6e",
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ fontWeight: 700 }}>🎯 タップ時:</span>
                    {form.image_action_type === "message" && (
                      <span>
                        メッセージ送信 <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4 }}>
                          {form.image_action_text || "（未入力）"}
                        </code>
                      </span>
                    )}
                    {form.image_action_type === "uri" && (
                      <span>URL を開く <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, wordBreak: "break-all" }}>
                        {form.image_action_url || "（未入力）"}
                      </code></span>
                    )}
                    {form.image_action_type === "liff" && <span>LIFF ページを開く（実装予定）</span>}
                    {form.image_action_type === "postback" && <span>内部イベント発火（実装予定）</span>}
                  </div>
                )}
              </>
            )}

            {/* ── 謎 ── */}
            {mtype === "riddle" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="riddle_id">
                    謎 <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select
                    id="riddle_id"
                    className="form-input"
                    value={form.riddle_id}
                    onChange={(e) => set("riddle_id", e.target.value)}
                  >
                    <option value="">— 謎を選択してください —</option>
                    {riddles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_riddle">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_riddle"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: 謎が届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── 動画 ── */}
            {mtype === "video" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="asset_url_video">
                    動画 URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="asset_url_video"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_video">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_video"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: 動画が届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── カルーセル ── */}
            {mtype === "carousel" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel}>
                    カード <span style={{ color: "#dc2626" }}>*</span>
                    <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                      ({form.carousel_items.length} / 10枚)
                    </span>
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    {form.carousel_items.map((card, index) => (
                      <div
                        key={index}
                        style={{
                          padding: "14px 16px",
                          border: "1px solid #e5e5e5",
                          borderRadius: 8,
                          background: "#fafafa",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 10,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                            カード {index + 1}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              padding: "2px 8px",
                              fontSize: 11,
                              color: "#ef4444",
                              borderColor: "#fecaca",
                            }}
                            onClick={() => removeCard(index)}
                          >
                            削除
                          </button>
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            タイトル
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            value={card.title}
                            onChange={(e) => updateCard(index, "title", e.target.value)}
                            placeholder="カードのタイトル"
                            maxLength={100}
                            style={{ fontSize: 13 }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            本文（任意）
                          </label>
                          <textarea
                            className="form-input"
                            value={card.body}
                            onChange={(e) => updateCard(index, "body", e.target.value)}
                            placeholder="カードの説明文"
                            maxLength={500}
                            rows={2}
                            style={{ fontSize: 13, resize: "vertical" }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            画像 URL（任意）
                          </label>
                          <input
                            type="url"
                            className="form-input"
                            value={card.image_url}
                            onChange={(e) => updateCard(index, "image_url", e.target.value)}
                            placeholder="https://example.com/image.png"
                            style={{ fontFamily: "monospace", fontSize: 12 }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            ボタンラベル（任意）
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            value={card.button_label}
                            onChange={(e) => updateCard(index, "button_label", e.target.value)}
                            placeholder="例: 詳しく見る"
                            maxLength={50}
                            style={{ fontSize: 13 }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <TapDestinationSection
                            label="ボタンの遷移先（任意）"
                            workId={workId}
                            oaId={oaId}
                            mode={card.destination_id ? "destination" : card.button_url ? "direct_url" : "none"}
                            destinationId={card.destination_id ?? null}
                            directUrl={card.button_url}
                            destinations={destinations}
                            onModeChange={(m) => {
                              const items = [...form.carousel_items];
                              if (m === "destination") items[index] = { ...items[index], button_url: "" };
                              if (m === "direct_url") items[index] = { ...items[index], destination_id: null };
                              if (m === "none") items[index] = { ...items[index], button_url: "", destination_id: null };
                              set("carousel_items", items);
                            }}
                            onDestinationChange={(id) => {
                              const items = [...form.carousel_items];
                              items[index] = { ...items[index], destination_id: id };
                              set("carousel_items", items);
                            }}
                            onDirectUrlChange={(url) => updateCard(index, "button_url", url)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {form.carousel_items.length < 10 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 13, padding: "6px 14px" }}
                      onClick={addCard}
                    >
                      ＋ カードを追加
                    </button>
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_carousel">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_carousel"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: カルーセルが届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── ボイス ── */}
            {mtype === "voice" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="asset_url_voice">
                    音声ファイル URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="asset_url_voice"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/audio.m4a"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                  <div style={hintText}>
                    LINE が対応する音声形式: M4A (AAC)・最大60秒
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_voice">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_voice"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: ボイスメッセージが届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

                {/* ── 演出設定（返信までの待機時間・既読・ローディング）──
                    「返信までの待機時間」(lag_ms) は演出設定の最上部に表示（headDelayMs/onHeadDelayChange）。 */}
                <TimingConfigSection
                  form={form}
                  set={set}
                  headDelayMs={form.lag_ms}
                  onHeadDelayChange={(ms) => set("lag_ms", ms)}
                />

              </div>{/* /padding */}
            </div>{/* /1通目ラッパー */}

            {/* === 2通目以降 === */}
            {/* freeInput 境界: head か途中スロットが freeInput なら、それ以降は「自由入力後の応答」。
                runtime（buildMessageChain/buildPhaseMessages）は freeInput で即時送信を停止するため、
                以降のスロットは通常の連続送信では届かない。編集UI上でも区切って明示する。 */}
            {(() => {
              const headFree   = !!form.free_input_enabled;
              const fiSlotIdx  = form.additionalMessages.findIndex((s) => s.free_input_enabled);
              const firstAfter = headFree ? 0 : (fiSlotIdx >= 0 ? fiSlotIdx + 1 : -1);
              return form.additionalMessages.map((slot, idx) => {
                const afterFreeInput = firstAfter >= 0 && idx >= firstAfter;
                return (
                  <div key={slot.existingId ?? `slot-${idx}`}>
                    {afterFreeInput && idx === firstAfter && (
                      <div style={{ margin: "12px 0 4px", padding: "6px 10px", background: "#faf5ff", border: "1px dashed #d8b4fe", borderRadius: 6, fontSize: 11, color: "#7c3aed", lineHeight: 1.6 }}>
                        ── ここから下は<strong>自由入力後の応答</strong>です。通常の連続メッセージとしては送信されず、ユーザーが自由入力を送信した後に配信されます。──
                      </div>
                    )}
                    <AdditionalMessageBlock
                      index={idx}
                      slot={slot}
                      oaId={oaId}
                      workId={workId}
                      characters={characters}
                      allMessages={allMessages}
                      canMoveUp={canMove(form.additionalMessages, idx, "up")}
                      canMoveDown={canMove(form.additionalMessages, idx, "down")}
                      onMoveUp={() => setForm((prev) => ({ ...prev, additionalMessages: moveSlot(prev.additionalMessages, idx, "up") }))}
                      onMoveDown={() => setForm((prev) => ({ ...prev, additionalMessages: moveSlot(prev.additionalMessages, idx, "down") }))}
                      canDetach={!!slot.existingId}
                      onDetach={() => {
                        const detachId = slot.existingId;
                        if (!detachId) return;
                        // 非破壊の切り離し。freeInput プロンプトの場合は応答保持の注意を添える。
                        const note = slot.free_input_enabled
                          ? "この自由入力メッセージはchainから外され、単体メッセージとして残ります。\n自由入力後の応答設定は保持されます。"
                          : "このメッセージは削除されません。連続メッセージから外れ、単体メッセージとして残ります。";
                        if (!window.confirm(`${note}\n\nchainから外しますか？`)) return;
                        setForm((prev) => ({
                          ...prev,
                          additionalMessages: prev.additionalMessages.filter((_, i) => i !== idx),
                          detachedMessageIds: [...(prev.detachedMessageIds ?? []), detachId],
                        }));
                      }}
                      onChange={(updated) => {
                        setForm((prev) => ({
                          ...prev,
                          additionalMessages: prev.additionalMessages.map((s, i) =>
                            i === idx ? updated : s
                          ),
                        }));
                      }}
                      onRemove={() => {
                        setForm((prev) => ({
                          ...prev,
                          additionalMessages: prev.additionalMessages.filter((_, i) => i !== idx),
                        }));
                      }}
                    />
                    {/* スロット間「＋ここに追加」（#6-3）。freeInput より下には出さない（末尾固定）。
                        head 自体が freeInput プロンプトのときは送信 chain に slot を足せない。 */}
                    {!headFree && canInsertAt(form.additionalMessages, idx + 1) && (
                      <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "6px 0" }}>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            additionalMessages: insertSlotAt(prev.additionalMessages, idx + 1, { ...EMPTY_ADDITIONAL_SLOT, carousel_items: [] }),
                          }))}
                          style={{
                            fontSize: 11, padding: "3px 12px", border: "1px dashed #cbd5e1", borderRadius: 999,
                            background: "#fff", color: "#64748b", cursor: "pointer",
                          }}
                        >
                          ＋ ここに追加
                        </button>
                        {!isNew && messageId && (
                          <button
                            type="button"
                            onClick={() => setImportPicker({
                              insertIndex: idx + 1,
                              appendAtEnd: !hasFreeInputSlot(form.additionalMessages) && idx + 1 === form.additionalMessages.length,
                            })}
                            style={{
                              fontSize: 11, padding: "3px 12px", border: "1px dashed #93c5fd", borderRadius: 999,
                              background: "#fff", color: "#2563eb", cursor: "pointer",
                            }}
                          >
                            ＋ 既存を取り込む
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}

            {/* 末尾追加（#6-3）。freeInput がある場合はその直前に追加し、末尾固定を保つ。
                head 自体が freeInput プロンプトのときは送信 chain に追加できない（応答は別枠）。 */}
            {form.free_input_enabled ? (
              <div style={{ marginTop: 14, padding: "8px 12px", background: "#faf5ff", border: "1px dashed #d8b4fe", borderRadius: 8, fontSize: 11, color: "#7c3aed", lineHeight: 1.6 }}>
                1通目が自由入力プロンプトのため、連続メッセージは追加できません（自由入力後の応答は別枠で管理します）。
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    additionalMessages: appendSlot(prev.additionalMessages, { ...EMPTY_ADDITIONAL_SLOT, carousel_items: [] }),
                  }))
                }
                style={{
                  marginTop: 14, width: "100%", padding: "10px 0",
                  border: "2px dashed #d1d5db", borderRadius: 8, background: "#f9fafb",
                  color: "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.15s",
                }}
                onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#06C755"; (e.currentTarget as HTMLButtonElement).style.color = "#059669"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#d1d5db"; (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; }}
              >
                {hasFreeInputSlot(form.additionalMessages)
                  ? "＋ 自由入力の前にメッセージを追加"
                  : `＋ メッセージを追加（${form.additionalMessages.length + 2}通目）`}
              </button>
            )}

            {/* 既存メッセージ取り込み（#6-4d・PR3b-2）。head が確定している編集時のみ。 */}
            {!form.free_input_enabled && !isNew && messageId && (
              <button
                type="button"
                onClick={() => setImportPicker({
                  insertIndex: appendIndex(form.additionalMessages),
                  appendAtEnd: !hasFreeInputSlot(form.additionalMessages),
                })}
                style={{
                  marginTop: 8, width: "100%", padding: "8px 0",
                  border: "1px dashed #93c5fd", borderRadius: 8, background: "#eff6ff",
                  color: "#2563eb", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                ＋ 既存メッセージを取り込む
              </button>
            )}

            {/* 実機での送信プレビュー（freeInput停止・応答分離・5通超え・QR末尾。runtime準拠） */}
            {(() => {
              const pv = previewChainSend(
                { body: form.body, message_type: form.message_type, free_input_enabled: form.free_input_enabled },
                form.additionalMessages.map((s) => ({ body: s.body, message_type: s.message_type, free_input_enabled: s.free_input_enabled })),
              );
              // #6-2b: 自由入力後の応答は連続スロットではなく「別枠の参照メッセージ」。
              // freeInput プロンプト（head か末尾スロット）の free_input_next_message_id を解決して表示する。
              const fiResponseId = form.free_input_enabled
                ? form.free_input_next_message_id
                : (form.additionalMessages.find((s) => s.free_input_enabled)?.free_input_next_message_id ?? "");
              const fiResponseMsg = fiResponseId ? allMessages.find((m) => m.id === fiResponseId) : undefined;
              const fiResponseLabel = fiResponseMsg
                ? ((fiResponseMsg.body ?? "").replace(/\n/g, " ").trim().slice(0, 36) || `(${fiResponseMsg.message_type ?? "メッセージ"})`)
                : null;
              return (
                <div style={{ marginTop: 16, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    📤 実機での送信プレビュー（このメッセージで一度に届く順）
                  </div>
                  <div style={{ color: "#475569" }}>このメッセージで送信: <strong>{pv.total}通</strong></div>
                  <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {pv.sendMessages.map((m) => (
                      <li key={m.index} style={{ color: m.freeInput ? "#b45309" : "#334155" }}>
                        {m.label}{m.freeInput ? "（自由入力プロンプト）" : ""}
                      </li>
                    ))}
                  </ol>
                  {pv.freeInputAt !== null && (
                    <div style={{ marginTop: 6, padding: "6px 8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, color: "#92400e" }}>
                      ⏸ ここでユーザー入力を待ちます。以降のメッセージは入力後に送信されます。
                    </div>
                  )}
                  {pv.responseMessages.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 700, color: "#6d28d9" }}>自由入力後に送るメッセージ（応答）</div>
                      <div style={{ color: "#7c3aed", fontSize: 11 }}>
                        これらは通常の連続メッセージとしては送信されず、ユーザーが自由入力を送信した後に配信されます。
                      </div>
                      <ol style={{ margin: "4px 0 0", paddingLeft: 20, color: "#6d28d9" }}>
                        {pv.responseMessages.map((m) => (<li key={`r-${m.index}`}>{m.label}</li>))}
                      </ol>
                    </div>
                  )}
                  {/* #6-2b: freeInputNext で参照される応答メッセージ（別枠）。 */}
                  {pv.freeInputAt !== null && fiResponseLabel && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 700, color: "#6d28d9" }}>自由入力後の応答（別枠で管理）</div>
                      <div style={{ color: "#7c3aed", fontSize: 11 }}>
                        ユーザーが自由入力を送信した後にこのメッセージへ進みます（連続メッセージ本体には含まれません。内容は応答メッセージ側の編集画面で編集します）。
                      </div>
                      <ol style={{ margin: "4px 0 0", paddingLeft: 20, color: "#6d28d9" }}>
                        <li>{fiResponseLabel}</li>
                      </ol>
                    </div>
                  )}
                  {pv.freeInputAt !== null && !fiResponseLabel && (
                    <div style={{ marginTop: 8, color: "#7c3aed", fontSize: 11 }}>
                      ℹ️ 自由入力の受付のみで、応答メッセージは未設定です（自由入力後に追加で送るメッセージはありません）。
                    </div>
                  )}
                  {pv.overLimit && (
                    <div style={{ marginTop: 8, color: "#b91c1c" }}>
                      ⚠️ 一度に送るメッセージが{pv.total}通で、5通を超えています。6通目以降は <strong>Push 送信</strong>となり、LINE 公式アカウントの<strong>月間メッセージ通数を消費</strong>する可能性があります（届かない場合あり）。QR・自由入力・フェーズ遷移で5通以内に区切ってください。
                    </div>
                  )}
                  {/* まとめ送信廃止方針（Phase 1）: 2通以上を自動連続送信している箇所に廃止予定を明示。 */}
                  {pv.sendMessages.length > 1 && (
                    <div style={{ marginTop: 8, padding: "8px 10px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, color: "#9a3412", fontSize: 11, lineHeight: 1.6 }}>
                      ⚠️ <strong>複数メッセージの自動まとめ送信は廃止予定です。</strong>次のメッセージへ進めるには、Quick Reply・キーワード・QR・GPS などの遷移条件を設定してください。<br />
                      （現状、この {pv.total} 通は1回の送信でまとめて届きますが、各メッセージ個別の待機時間・入力中表示は反映されません）
                    </div>
                  )}
                  {form.quick_replies.length > 0 && (
                    <div style={{ marginTop: 8, color: "#0369a1", fontSize: 11 }}>
                      ℹ️ Quick Reply は編集上は先頭メッセージに設定しますが、実機ではこの連続メッセージの<strong>末尾</strong>に表示されます。
                    </div>
                  )}
                </div>
              );
            })()}
          </SectionAccordion>
          )} {/* /!isPuzzle */}

          {/* ── 「詳細設定」 視覚的区切り (= 以下は任意/上級者向け、デフォルト折りたたみ) ── */}
          <div className="msg-section-divider" aria-hidden="true">
            <span>詳細設定（任意）</span>
          </div>
          <p className="msg-section-divider-hint" aria-hidden="true">
            返信時の選択肢や自由入力など、必要な場合だけ設定します
          </p>

          {/* ════════════════════════════════════════
              クイックリプライ設定（メッセージ・謎 共通）
          ════════════════════════════════════════ */}
          <QuickReplyEditor
            items={form.quick_replies}
            onChange={(items) => set("quick_replies", items)}
            responseMessages={allMessages.filter((m) => m.kind === "response" && m.id !== messageId)}
            phases={phases}
            transitionMessages={allMessages.filter((m) => m.id !== messageId)}
            characters={characters}
            workId={workId}
            oaId={oaId}
            destinations={destinations}
            allMessages={allMessages}
          />

          {/* ════════════════════════════════════════
              自由入力受付（クイックリプライの直後に配置）
              このメッセージ送信後、ユーザーの次のテキスト入力を変数として保存できる。
              名前入力 / アンケート自由回答 / 任意テキストの記録などに使用。
              通常は OFF。puzzle / system_notice では無効化する。
          ════════════════════════════════════════ */}
          {!isPuzzle && form.kind !== "system_notice" && (
            <SectionAccordion
              title="このメッセージ送信後に自由入力を受け付ける"
              optional
              description="このメッセージを送信した直後に、ユーザーの次の入力を変数として保存します。"
              defaultOpen={form.free_input_enabled}
            >
              {/* 使い分けの案内 (= 1通目の直後 vs 2通目以降の直後) */}
              <div style={{
                fontSize: 12, lineHeight: 1.6, padding: "10px 12px", marginBottom: 12,
                background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, color: "#075985",
              }}>
                「どのメッセージの直後に入力を待つか」で設定場所を選びます。
                <br />
                1通目の直後に待つ場合は <strong>このメインメッセージ側</strong>、
                2通目以降の直後に待つ場合は <strong>該当する追加メッセージ側</strong> で ON にしてください。
              </div>
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.free_input_enabled}
                    onChange={(e) => set("free_input_enabled", e.target.checked)}
                  />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>このメッセージ送信後に自由入力を受け付ける</span>
                </label>
                <div style={{ ...hintText, marginTop: 4 }}>
                  このメッセージを送信した直後に、ユーザーの次の入力を変数として保存します。
                  <br />
                  名前入力 / アンケート自由回答 / 任意の感想記録などに使えます。
                </div>
              </div>

              {form.free_input_enabled && (
                <>
                  {/* 保存先変数名 (任意) */}
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label style={fieldLabel} htmlFor="free_input_variable_key">
                      保存する変数名
                      <span style={{ fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
                    </label>
                    <input
                      id="free_input_variable_key"
                      type="text"
                      className="form-input"
                      style={{ maxWidth: 320 }}
                      value={form.free_input_variable_key}
                      onChange={(e) => set("free_input_variable_key", e.target.value)}
                      placeholder="例: userName（差し込みが不要なら空欄でOK）"
                      maxLength={60}
                      autoComplete="off"
                    />
                    {(() => {
                      const v = form.free_input_variable_key.trim();
                      const validRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
                      if (v && !validRegex.test(v)) {
                        return (
                          <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>
                            変数名は半角英数字とアンダースコアで入力してください。先頭に数字は使えません。
                          </div>
                        );
                      }
                      return (
                        <div style={hintText}>
                          入力内容を次のメッセージで使いたい場合のみ設定します。<br />
                          例：名前なら <code>userName</code>、感想なら <code>feedback</code>。<br />
                          本文に <code>{"{userName}"}</code> のように書くと、保存した入力内容を差し込めます。<br />
                          空欄のままにすると、入力は受け付けますが変数として保存はされません（ログ用途）。
                        </div>
                      );
                    })()}
                  </div>

                  {/* 入力後の次メッセージ */}
                  <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
                    <label style={fieldLabel} htmlFor="free_input_next_message_id">
                      入力後に送信するメッセージ
                    </label>
                    <select
                      id="free_input_next_message_id"
                      className="form-input"
                      value={form.free_input_next_message_id}
                      onChange={(e) => set("free_input_next_message_id", e.target.value)}
                    >
                      <option value="">— 選択しない（次メッセージを送らない）—</option>
                      {allMessages
                        .filter((m) => m.id !== messageId)
                        .map((m) => {
                          const label = m.body?.trim().slice(0, 30) || `(本文なし) id=${m.id.slice(0, 8)}`;
                          return (
                            <option key={m.id} value={m.id}>
                              {label}
                            </option>
                          );
                        })}
                    </select>
                    <div style={hintText}>
                      ユーザー入力を受け取った後に送信するメッセージ。
                      {form.free_input_variable_key.trim() ? (
                        <>本文に <code>{`{${form.free_input_variable_key.trim()}}`}</code> と書くと、保存した値が差し込まれます。</>
                      ) : (
                        <>変数名を設定していないため、ここでは入力内容を差し込みません（受け取って次へ進むだけ）。</>
                      )}
                    </div>
                  </div>
                </>
              )}
            </SectionAccordion>
          )}

          {/* ════════════════════════════════════════
              謎の回答設定（puzzle のみ）
          ════════════════════════════════════════ */}
          {isPuzzle && (
          <SectionAccordion
            title="謎の回答設定"
            required
            description="正解の判定方法と、合致した時の動作を設定します"
            defaultOpen={true}
          >

            {/* answer */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="puzzle_answer">
                答え <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                id="puzzle_answer"
                type="text"
                className="form-input"
                value={form.answer}
                onChange={(e) => set("answer", e.target.value)}
                placeholder="例: 桜"
                maxLength={200}
              />
            </div>

            {/* 照合条件（exact / partial 排他ラジオ） */}
            <div className="form-group">
              <label style={fieldLabel}>照合条件 <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { value: "exact"   as const, label: "完全一致", desc: "NFKC正規化後に完全一致するか確認します" },
                    { value: "partial" as const, label: "部分一致", desc: "入力文の中に答えが含まれていれば正解にします" },
                  ]
                ).map(({ value, label, desc }) => (
                  <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="answer_match_mode"
                      value={value}
                      checked={matchMode === value}
                      onChange={() => setMatchMode(value)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
                      <div style={hintText}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* 正規化オプション（任意・複数選択可） */}
            <div className="form-group">
              <label style={fieldLabel}>正規化オプション</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { value: "normalize_width"    as const, label: "全角半角を無視", desc: "全角・半角の違いを無視して照合します" },
                    { value: "ignore_punctuation" as const, label: "句読点を無視",   desc: "句点・読点・記号を除去して照合します" },
                  ]
                ).map(({ value, label, desc }) => (
                  <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.answer_match_type.includes(value)}
                      onChange={() => toggleMatchOption(value)}
                      style={{ marginTop: 2 }}
                    />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
                      <div style={hintText}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* correct_action */}
            <div className="form-group">
              <label style={fieldLabel}>正解時アクション <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { value: "text" as const,                label: "テキスト返信のみ",       desc: "正解メッセージを返信してフェーズはそのまま" },
                    { value: "transition" as const,          label: "フェーズ遷移のみ",        desc: "指定フェーズへ遷移してそのフェーズのメッセージを送信" },
                    { value: "text_and_transition" as const, label: "テキスト＋フェーズ遷移",  desc: "正解メッセージを送信しつつ次フェーズへ遷移" },
                  ]
                ).map(({ value, label, desc }) => (
                  <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="correct_action"
                      value={value}
                      checked={form.correct_action === value}
                      onChange={() => set("correct_action", value)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
                      <div style={hintText}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* correct_text */}
            {(form.correct_action === "text" || form.correct_action === "text_and_transition") && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="correct_text">
                正解メッセージ <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea
                id="correct_text"
                className="form-input"
                style={{ minHeight: 80, resize: "vertical" }}
                value={form.correct_text}
                onChange={(e) => set("correct_text", e.target.value)}
                placeholder="例: 正解！よく気づきましたね。"
                maxLength={1000}
              />
            </div>
            )}

            {/* correct_next_phase_id */}
            {(form.correct_action === "transition" || form.correct_action === "text_and_transition") && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="correct_next_phase">
                遷移先フェーズ <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select
                id="correct_next_phase"
                className="form-input"
                value={form.correct_next_phase_id}
                onChange={(e) => set("correct_next_phase_id", e.target.value)}
              >
                <option value="">— フェーズを選択 —</option>
                {phases.map((ph) => (
                  <option key={ph.id} value={ph.id}>{ph.name}</option>
                ))}
              </select>
            </div>
            )}

            {/* incorrect_text */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="incorrect_text">不正解メッセージ（任意）</label>
              <input
                id="incorrect_text"
                type="text"
                className="form-input"
                value={form.incorrect_text}
                onChange={(e) => set("incorrect_text", e.target.value)}
                placeholder="例: 答えが違います。もう一度考えてみてください。"
                maxLength={400}
              />
              <div style={hintText}>空欄の場合: 「答えが違います。もう一度考えてみてください。」が使われます</div>
            </div>

            {/* incorrect_quick_replies */}
            <div className="form-group">
              <label style={fieldLabel}>不正解時クイックリプライ（任意）</label>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                不正解メッセージに添付するクイックリプライボタン（最大13件）
              </div>
              <QuickReplyEditor
                items={form.incorrect_quick_replies}
                onChange={(items) => set("incorrect_quick_replies", items)}
                responseMessages={allMessages.filter((m) => m.kind === "response" && m.id !== messageId)}
                phases={phases}
                transitionMessages={allMessages.filter((m) => m.id !== messageId)}
                characters={characters}
                workId={workId}
                oaId={oaId}
                destinations={destinations}
                allMessages={allMessages}
              />
            </div>

            {/* ヒント表示モード */}
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label style={fieldLabel}>ヒント表示モード</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {([
                  { value: "always",   label: "💡 常に表示",        desc: "クイックリプライにヒントボタンを常時表示します" },
                  { value: "on_wrong", label: "不正解時のみ",   desc: "不正解の回答をした後にのみヒントボタンを表示します" },
                  { value: "hidden",   label: "🚫 非表示",          desc: "ヒントボタンを表示しません" },
                ] as const).map((opt) => (
                  <label
                    key={opt.value}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                      border: `1.5px solid ${form.hint_mode === opt.value ? "#6366f1" : "#e5e7eb"}`,
                      background: form.hint_mode === opt.value ? "#f5f3ff" : "#fff",
                    }}
                  >
                    <input
                      type="radio"
                      name="hint_mode"
                      value={opt.value}
                      checked={form.hint_mode === opt.value}
                      onChange={() => set("hint_mode", opt.value)}
                      style={{ marginTop: 2, accentColor: "#6366f1" }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* puzzle_hint_text */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="puzzle_hint_text">ヒントテキスト（任意）</label>
              <textarea
                id="puzzle_hint_text"
                className="form-input"
                style={{ minHeight: 70, resize: "vertical" }}
                value={form.puzzle_hint_text}
                onChange={(e) => set("puzzle_hint_text", e.target.value)}
                placeholder="ユーザーがヒントを求めたときに送信するテキスト"
                maxLength={1000}
              />
            </div>
          </SectionAccordion>
          )} {/* /isPuzzle 謎の回答設定 */}

          {/* ── このメッセージの後の遷移 ── */}
          {/* 謎・問題で正解時アクションがフェーズ遷移の場合は、遷移が競合するため
              このセクションを編集不可（グレーアウト）にする。正解時アクションを
              フェーズ遷移以外に戻すと自動的に再び編集可能になる（reactive）。 */}
          {form.phase_id && form.kind !== "global" && (
            <PhaseTransitionsSection
              oaId={oaId}
              workId={workId}
              phaseId={form.phase_id}
              phases={phases}
              disabled={nextTransitionDisabledByPuzzle({ isPuzzle, correctAction: form.correct_action })}
            />
          )}

          {/* ── アクションフッター (= sticky で画面下部に固定) ── */}
          {/* スクロール量が多い長いフォームでも、保存ボタンが常に視界に入るようにする。 */}
          {/* 削除 / キャンセル / 保存 のロジックは旧 inline 版から完全維持。 */}
          <div className="msg-action-footer" role="group" aria-label="保存・キャンセル操作">
            {!isNew && onDelete ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting || submitting}
                onClick={() => {
                  if (confirm("このメッセージを削除しますか？")) onDelete?.();
                }}
              >
                {deleting ? (
                  <><span className="spinner" /> 削除中…</>
                ) : (
                  "削除"
                )}
              </button>
            ) : (
              <div />
            )}
            <div className="msg-action-group">
              <Link href={`/oas/${oaId}/works/${workId}/messages`} className="btn btn-ghost">
                キャンセル
              </Link>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? (
                  <><span className="spinner" /> 保存中…</>
                ) : isNew ? (
                  "作成"
                ) : (
                  "保存"
                )}
              </button>
            </div>
          </div>
        </form>

        {/* ── 右カラム: LINEプレビュー（sticky） ── */}
        <div className="msg-preview-col">
          {/* ラベル */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#06C755",
              background: "#E6F7ED", borderRadius: 6,
              padding: "2px 8px", border: "1px solid #06C75533",
              letterSpacing: 0.5,
            }}>
              LINE プレビュー
            </span>
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              編集内容がリアルタイム反映されます
            </span>
          </div>
          <PreviewPanel
            chain={previewChain}
            characters={characters}
            riddles={riddles}
            destinations={destinations}
          />
        </div>
      </div>

      {/* 既存メッセージ取り込み modal（#6-4d・PR3b-2）。form state へ反映するのみ（DB保存は通常の「保存」）。 */}
      {importPicker && messageId && (() => {
        const targetChainIds = [
          messageId,
          ...form.additionalMessages.map((s) => s.existingId).filter((x): x is string => !!x),
        ];
        const pv = previewChainSend(
          { body: form.body, message_type: form.message_type, free_input_enabled: form.free_input_enabled },
          form.additionalMessages.map((s) => ({ body: s.body, message_type: s.message_type, free_input_enabled: s.free_input_enabled })),
        );
        return (
          <ImportPicker
            open
            onClose={() => setImportPicker(null)}
            targetHeadId={messageId}
            workId={workId}
            targetPhaseId={form.phase_id || null}
            targetChainIds={targetChainIds}
            targetSendCount={pv.total}
            insertIndex={importPicker.insertIndex}
            appendAtEnd={importPicker.appendAtEnd}
            importMessages={allMessages.map(toImportMessage)}
            phaseNames={Object.fromEntries(phases.map((p) => [p.id, p.name]))}
            onImport={(slots, insertIndex) =>
              setForm((prev) => ({
                ...prev,
                additionalMessages: insertImportedSlots(prev.additionalMessages, insertIndex, slots),
              }))
            }
          />
        );
      })()}
    </>
  );
}
