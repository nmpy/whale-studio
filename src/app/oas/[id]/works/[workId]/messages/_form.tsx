// src/app/oas/[id]/works/[workId]/messages/_form.tsx
// 共有メッセージフォーム（新規・編集ページで使用）

"use client";
import DurationInput from "@/components/DurationInput";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { phaseApi, characterApi, riddleApi, messageApi, locationApi, uploadApi, getDevToken, getAuthHeaders } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PhaseWithCounts, Character, QuickReplyItem, QuickReplyAction, ReadReceiptMode, LocationWithTransition } from "@/types";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import { isQrCrossPhaseMessageTarget, resolveQrTargetMessagePhaseId } from "./_qr-transition-check";
import type { Riddle } from "@/types";
import { previewQrSend, type QrPreviewMessage } from "./_qr-preview";
import {
  normalizeCarouselContent, serializeCarouselContent, validateCarousel,
  emptyCarouselCard, CAROUSEL_MAX_CARDS, CAROUSEL_CARD_TYPES,
  type CarouselCardType, type CarouselCard, type CarouselAction, type CarouselActionType,
} from "@/lib/carousel";
import { resolveDisplayQrItems } from "@/lib/hint-qr";
import { previewChainSend } from "./_chain-send-preview";
import { moveSlot, insertSlotAt, appendSlot, canMove, canInsertAt, hasFreeInputSlot, appendIndex } from "./_chain-reorder";
import { ImportPicker } from "./_import-picker";
import { toImportMessage, insertImportedSlots } from "./_chain-import";
import { TapDestinationSection } from "@/components/destination/TapDestinationSection";
import type { TapMode } from "@/components/destination/TapDestinationSection";
import { LinkPicker, LinkCopyList, useWorkLinkOptions, type LinkOption } from "@/components/destination/LinkPicker";
import { detectTapMode } from "@/lib/message-destination-utils";
import { RequiredMark } from "@/components/RequiredMark";
import { MediaUploadButton } from "@/components/MediaUploadButton";
import { parseSizeString, resolveVideoFormIssues, videoFormSaveError, resolveVideoUsage } from "@/lib/message-media-form";
import { FlexPreview } from "@/components/flex/FlexPreview";
import { Switch } from "@/components/Switch";
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
  timingFormHasEffect,
  EMPTY_SCHEDULED_MESSAGE,
  scheduledSettingsToFormState,
  formStateToScheduledSettings,
  SLOT_LAG_MS_MAX,
  SLOT_LAG_SECONDS_MAX,
  clampNewSlotLagMs,
  CHAIN_SPEAKER_NONE,
  type AdditionalMessageSlot as _AdditionalMessageSlot,
  type ScheduledMessageFormState,
} from "./_form-helpers";
export type { ScheduledMessageFormState } from "./_form-helpers";
export { EMPTY_SCHEDULED_MESSAGE } from "./_form-helpers";
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
  // ── 動画メディアの保存方式・メタ（message_type="video" 用）──
  /** "" = 既存（アップロード扱い） | "upload" | "external_url" */
  asset_media_source: string;
  /** 動画の previewImageUrl 専用サムネ URL（JPEG/PNG）。LINE video 用途では必須。 */
  asset_preview_url:  string;
  /** "" = 既存（LINE 動画相当） | "line_video" | "liff_playback" | "cms_preview" */
  asset_usage:        string;
  /** probe で取得した MIME（例 "video/mp4"）。取得できなければ ""。 */
  asset_mime_type:    string;
  /** probe で取得したサイズ(bytes)。フォーム状態は string（"" = 不明）。保存時に number 化。 */
  asset_file_size_bytes: string;
  notify_text:     string;
  riddle_id:       string;
  /** 謎(puzzle)カルーセル質問用の旧形式カード（kind="puzzle" のときのみ使用・挙動不変）。 */
  carousel_items:  MessageCarouselCard[];
  /** 通常メッセージ carousel のカードタイプ（kind!="puzzle"）。 */
  carousel_card_type: CarouselCardType;
  /** 通常メッセージ carousel のカード（kind!="puzzle"・src/lib/carousel の新形式）。 */
  carousel_cards:  CarouselCard[];
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
  // ── 送信後の待機トリガー（地点到着で自動進行）──
  /** "" = なし / "qr" / "gps"（"beacon" は次PRで対応予定のため UI 非表示）。 */
  checkin_trigger_type:            string;
  /** 検知対象の地点 ID（空文字 = 未選択）。type 設定時は必須。 */
  checkin_trigger_location_id:     string;
  /** 検知成功時に送る次メッセージ ID（空文字 = なし）。 */
  checkin_trigger_next_message_id: string;
  /** 検知成功時に進める次フェーズ ID（空文字 = なし）。 */
  checkin_trigger_next_phase_id:   string;
  sort_order:      number;
  is_active:       boolean;
  // ── 謎（puzzle）専用フィールド ──
  puzzle_type:           string;
  /** 後方互換の単一正解（保存時 answers[0] を反映）。UI は answers を編集する。 */
  answer:                string;
  /** 複数正解（いずれか一致で正解）。最低1件入力・空除外・trim・重複除外して保存。 */
  answers:               string[];
  puzzle_hint_text:      string;
  hint_mode:             "always" | "on_wrong" | "hidden";
  answer_match_type:     AnswerMatchType[];
  correct_action:        CorrectAction;
  correct_text:          string;
  /** 正解メッセージの発話キャラクター ID（"" = 未設定 → 本文キャラ→デフォルト） */
  correct_character_id:     string;
  incorrect_text:           string;
  /** 不正解メッセージの発話キャラクター ID（"" = 未設定 → 本文キャラ→デフォルト） */
  incorrect_character_id:   string;
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
  /** "" = なし。"message" | "uri" | "liff" | "postback" | "message_with_phase" */
  image_action_type:          "" | "message" | "uri" | "liff" | "postback" | "message_with_phase";
  image_action_text:          string;
  image_action_url:           string;
  /** type="message_with_phase" 用: 遷移先フェーズ ID。 */
  image_action_phase_id:      string;
  /** このメッセージ送信後に silent 自動遷移する先フェーズ ID（""＝無効）。キーワード遷移とは別物。 */
  auto_transition_phase_id:   string;
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
  // ── 時間差メッセージ（予約送信）設定（PR-4c-1: 保存のみ・runtime 未使用）──
  scheduled_message: ScheduledMessageFormState;
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
  asset_media_source: "",
  asset_preview_url:  "",
  asset_usage:        "",
  asset_mime_type:    "",
  asset_file_size_bytes: "",
  notify_text:     "",
  riddle_id:       "",
  carousel_items:  [],
  carousel_card_type: "product",
  carousel_cards:  [],
  quick_replies:   [],
  next_message_id: "",
  lag_ms:          0,
  // 自由入力受付（既定 OFF）
  free_input_enabled:         false,
  free_input_variable_key:    "",
  free_input_next_message_id: "",
  // 送信後の待機トリガー（既定 なし）
  checkin_trigger_type:            "",
  checkin_trigger_location_id:     "",
  checkin_trigger_next_message_id: "",
  checkin_trigger_next_phase_id:   "",
  sort_order:      0,
  is_active:       true,
  // puzzle defaults
  puzzle_type:           "",
  answer:                "",
  answers:               [""],
  puzzle_hint_text:      "",
  hint_mode:             "always",
  answer_match_type:     ["exact"],
  correct_action:        "text",
  correct_text:          "",
  correct_character_id:    "",
  incorrect_text:          "",
  incorrect_character_id:  "",
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
  image_action_phase_id:      "",
  auto_transition_phase_id:   "",
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
  scheduled_message:    { ...EMPTY_SCHEDULED_MESSAGE },
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
  asset_media_source?:   string | null;
  asset_preview_url?:    string | null;
  asset_usage?:          string | null;
  asset_mime_type?:      string | null;
  asset_file_size_bytes?: number | string | null;
  notify_text?:          string | null;
  riddle_id?:            string | null;
  quick_replies?:        QuickReplyItem[] | null;
  next_message_id?:      string | null;
  puzzle_type?:          string | null;
  answer?:               string | null;
  answers?:              string[] | null;
  puzzle_hint_text?:     string | null;
  hint_mode?:            string | null;
  answer_match_type?:    string[] | null;
  correct_action?:       string | null;
  correct_text?:            string | null;
  correct_character_id?:    string | null;
  incorrect_text?:          string | null;
  incorrect_character_id?:  string | null;
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
  image_action_phase_id?:     string | null;
  auto_transition_phase_id?:  string | null;
  image_action_liff_page_id?: string | null;
  image_action_postback_data?: string | null;
  alt_text?:                  string | null;
  flex_payload_json?:         string | null;
  // 自由入力受付
  free_input_enabled?:         boolean | null;
  free_input_variable_key?:    string | null;
  free_input_next_message_id?: string | null;
  // 送信後の待機トリガー
  checkin_trigger_type?:            string | null;
  checkin_trigger_location_id?:     string | null;
  checkin_trigger_next_message_id?: string | null;
  checkin_trigger_next_phase_id?:   string | null;
  // 時間差メッセージ設定（保存のみ）。API からは parse 済み object | null で届く。
  scheduled_message_settings?:      unknown;
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
  // carousel の復元: 謎(puzzle)は旧形式 carousel_items（挙動不変）、通常メッセージは新形式 carousel_cards。
  let carousel_items: MessageCarouselCard[] = [];
  let carousel_card_type: CarouselCardType = "product";
  let carousel_cards: CarouselCard[] = [];
  if (msg.message_type === "carousel" && msg.body) {
    if (msg.kind === "puzzle") {
      try {
        const parsed = JSON.parse(msg.body);
        if (Array.isArray(parsed)) carousel_items = parsed as MessageCarouselCard[];
      } catch {
        carousel_items = [];
      }
    } else {
      // 旧形式(ベア配列)/新形式どちらも normalizeCarouselContent で安全に復元（クラッシュしない）。
      const c = normalizeCarouselContent(msg.body);
      carousel_card_type = c.cardType;
      carousel_cards = c.cards;
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
    asset_media_source:    msg.asset_media_source ?? "",
    asset_preview_url:     msg.asset_preview_url  ?? "",
    asset_usage:           msg.asset_usage        ?? "",
    asset_mime_type:       msg.asset_mime_type    ?? "",
    asset_file_size_bytes: msg.asset_file_size_bytes != null ? String(msg.asset_file_size_bytes) : "",
    notify_text:           msg.notify_text     ?? "",
    riddle_id:             msg.riddle_id       ?? "",
    carousel_items,
    carousel_card_type,
    carousel_cards,
    quick_replies:         msg.quick_replies   ?? [],
    next_message_id:       msg.next_message_id ?? "",
    lag_ms:                msg.lag_ms          ?? 0,
    sort_order:            msg.sort_order      ?? 0,
    is_active:             msg.is_active       ?? true,
    puzzle_type:           msg.puzzle_type     ?? "",
    answer:                msg.answer          ?? "",
    // 複数正解の初期化（後方互換）: answers があればそれ、無ければ単一 answer を1件配列、どちらも無ければ空1件。
    answers: (() => {
      const arr = (msg.answers ?? []).map((a) => a ?? "").filter((a) => a.length > 0);
      if (arr.length > 0) return arr;
      const single = (msg.answer ?? "").trim();
      return single ? [single] : [""];
    })(),
    puzzle_hint_text:      msg.puzzle_hint_text ?? "",
    hint_mode: (msg.hint_mode as "always" | "on_wrong" | "hidden") ?? "always",
    answer_match_type:     (msg.answer_match_type ?? ["exact"]) as AnswerMatchType[],
    correct_action:        (msg.correct_action ?? "text") as CorrectAction,
    correct_text:            msg.correct_text    ?? "",
    correct_character_id:    msg.correct_character_id   ?? "",
    incorrect_text:          msg.incorrect_text  ?? "",
    incorrect_character_id:  msg.incorrect_character_id ?? "",
    incorrect_quick_replies: msg.incorrect_quick_replies ?? [],
    correct_next_phase_id:   msg.correct_next_phase_id ?? "",
    additionalMessages:      [],
    // タップ遷移先
    tap_destination_id:  msg.tap_destination_id ?? "",
    tap_url:             msg.tap_url ?? "",
    // 画像タップ時アクション。image_action があればそれを採用。無ければ旧 tap_url（直接URL）を
    // 「URLを開く(uri)」として後方互換で読み込む（tap_destination_id の解決は form 側 effect で実施）。
    image_action_type:          ((msg.image_action_type === "message" || msg.image_action_type === "uri"
                                  || msg.image_action_type === "liff" || msg.image_action_type === "postback"
                                  || msg.image_action_type === "message_with_phase")
                                  ? msg.image_action_type
                                  : (msg.message_type === "image" && (msg.tap_url ?? "").trim() ? "uri" : "")) as "" | "message" | "uri" | "liff" | "postback" | "message_with_phase",
    image_action_text:          msg.image_action_text         ?? "",
    image_action_url:           (msg.image_action_url ?? "")
                                  || (msg.message_type === "image" && !msg.image_action_type ? (msg.tap_url ?? "") : ""),
    image_action_phase_id:      msg.image_action_type === "message_with_phase" ? (msg.image_action_phase_id ?? "") : "",
    auto_transition_phase_id:   msg.auto_transition_phase_id ?? "",
    image_action_liff_page_id:  msg.image_action_liff_page_id ?? "",
    image_action_postback_data: msg.image_action_postback_data ?? "",
    alt_text:                   msg.alt_text                  ?? "",
    // Flex Message: 保存済み contents JSON を整形して textarea に復元
    flex_payload_json:          prettyFlexJson(msg.flex_payload_json),
    // 自由入力受付
    free_input_enabled:         msg.free_input_enabled         ?? false,
    free_input_variable_key:    msg.free_input_variable_key    ?? "",
    free_input_next_message_id: msg.free_input_next_message_id ?? "",
    // 送信後の待機トリガー（地点到着で自動進行）
    checkin_trigger_type:            msg.checkin_trigger_type            ?? "",
    checkin_trigger_location_id:     msg.checkin_trigger_location_id     ?? "",
    checkin_trigger_next_message_id: msg.checkin_trigger_next_message_id ?? "",
    checkin_trigger_next_phase_id:   msg.checkin_trigger_next_phase_id   ?? "",
    // 時間差メッセージ設定（保存のみ）。再編集で値を復元。
    scheduled_message:               scheduledSettingsToFormState(msg.scheduled_message_settings),
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
  // 複数正解: trim・空除外・重複除外。answer（後方互換の単一列）には先頭候補を保持する。
  const cleanedAnswers = isPuzzle
    ? Array.from(new Set(form.answers.map((a) => a.trim()).filter((a) => a.length > 0)))
    : [];
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
        // 謎(puzzle)は旧形式のまま保存（挙動不変）。通常メッセージは新形式 {type,cardType,cards} を保存。
        ? (isPuzzle
            ? JSON.stringify(form.carousel_items)
            : serializeCarouselContent({ type: "carousel", cardType: form.carousel_card_type, cards: form.carousel_cards }))
        : form.message_type === "text"
        ? form.body || undefined
        // puzzle の image/video でも body を保持（LINE 送信時のフォールバックテキストとして使用）
        : isPuzzle
        ? form.body || form.notify_text || undefined
        : undefined,
    asset_url:         (!isSystemNotice && (form.message_type === "image" || form.message_type === "video" || form.message_type === "voice"))
      ? form.asset_url || undefined
      : undefined,
    // 動画メディアのメタ（message_type="video" のときのみ保存。他型は null で明示クリア＝型切替時の残留防止）。
    // 本体は保存しない（URL とメタのみ）。BigInt 由来は number で送る（PR2 サーバが BigInt 化）。
    asset_media_source:    !isSystemNotice && form.message_type === "video" ? ((form.asset_media_source || null) as ("upload" | "external_url" | null)) : null,
    asset_preview_url:     !isSystemNotice && form.message_type === "video" ? (form.asset_preview_url || null) : null,
    // external_url の動画は用途未選択なら line_video を明示保存する（サーバ検証を効かせる＝UI 既定と一致）。
    // アップロード/既存は null のまま（後方互換＝送信側は line_video 相当で扱う）。
    asset_usage:           !isSystemNotice && form.message_type === "video"
      ? ((form.asset_usage || (form.asset_media_source === "external_url" ? "line_video" : null)) as ("line_video" | "liff_playback" | "cms_preview" | null))
      : null,
    asset_mime_type:       !isSystemNotice && form.message_type === "video" ? (form.asset_mime_type || null) : null,
    asset_file_size_bytes: !isSystemNotice && form.message_type === "video" ? parseSizeString(form.asset_file_size_bytes) : null,
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
    answer:                isPuzzle ? (cleanedAnswers[0] ?? null) : null,
    answers:               isPuzzle && cleanedAnswers.length > 0 ? cleanedAnswers : null,
    puzzle_hint_text:      isPuzzle ? form.puzzle_hint_text || null : null,
    answer_match_type:     isPuzzle ? form.answer_match_type : ["exact"],
    correct_action:        isPuzzle ? form.correct_action || null : null,
    correct_text:          isPuzzle ? form.correct_text || null : null,
    correct_character_id:    isPuzzle ? form.correct_character_id || null : null,
    incorrect_text:          isPuzzle ? form.incorrect_text || null : null,
    incorrect_character_id:  isPuzzle ? form.incorrect_character_id || null : null,
    incorrect_quick_replies: isPuzzle && form.incorrect_quick_replies.length > 0 ? form.incorrect_quick_replies : null,
    correct_next_phase_id:   isPuzzle ? form.correct_next_phase_id || null : null,
    hint_mode: form.hint_mode,
    // タップ遷移先
    // 画像メッセージのタップは image_action に一本化。保存時に旧 tap_* は null へ寄せる
    // （非画像メッセージの tap_* は従来どおり保持）。
    tap_destination_id: form.message_type === "image" ? null : (form.tap_destination_id || null),
    tap_url:            form.message_type === "image" ? null : (form.tap_url || null),
    // 画像タップ時アクション (画像メッセージのみ。type 空文字 = 無効)
    image_action_type:
      form.message_type === "image" && form.image_action_type
        ? (form.image_action_type as "message" | "uri" | "liff" | "postback" | "message_with_phase")
        : null,
    image_action_text:
      form.message_type === "image" && (form.image_action_type === "message" || form.image_action_type === "message_with_phase")
        ? (form.image_action_text.trim() || null)
        : null,
    image_action_url:
      form.message_type === "image" && form.image_action_type === "uri"
        ? (form.image_action_url.trim() || null)
        : null,
    image_action_phase_id:
      form.message_type === "image" && form.image_action_type === "message_with_phase"
        ? (form.image_action_phase_id.trim() || null)
        : null,
    // このメッセージ送信後の silent 自動フェーズ遷移（キーワード遷移とは別・入場メッセージは送らない）。
    auto_transition_phase_id: form.auto_transition_phase_id.trim() || null,
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
    // 送信後の待機トリガー（地点到着で自動進行）。種別なしのときは全て null。
    checkin_trigger_type:            form.checkin_trigger_type || null,
    checkin_trigger_location_id:     form.checkin_trigger_type ? (form.checkin_trigger_location_id || null) : null,
    checkin_trigger_next_message_id: form.checkin_trigger_type ? (form.checkin_trigger_next_message_id || null) : null,
    checkin_trigger_next_phase_id:   form.checkin_trigger_type ? (form.checkin_trigger_next_phase_id || null) : null,
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
    // 時間差メッセージ設定（保存のみ・runtime 未使用）。未操作なら null。
    scheduled_message_settings: formStateToScheduledSettings(form.scheduled_message),
  };
  console.log("[formStateToMsgBody] payload:", JSON.stringify(payload, null, 2));
  return payload;
}

// ── バリデーション ────────────────────────────────────────

export function validateMessageForm(form: MessageFormState, phases: { id: string }[] = []): string | null {
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
    // 連続メッセージ carousel もバックエンドと同じ validateCarousel で検証（最大5枚・必須項目）。
    if (slot.message_type === "carousel") {
      const err = validateCarousel({ type: "carousel", cardType: slot.carousel_card_type, cards: slot.carousel_cards });
      if (err) return `${i + 2}通目: ${err}`;
    }
    // 連続メッセージの画像タップ時アクション（message は末尾スロットのみ許可）。
    if (slot.message_type === "image" && slot.image_action_type) {
      const slotIsTail = i === form.additionalMessages.length - 1 || slot.free_input_enabled;
      if (slot.image_action_type === "message") {
        if (!slotIsTail) return `${i + 2}通目: 「メッセージを送信する」は連続メッセージの最後の画像でのみ設定できます。「なし」か「URLを開く」にしてください`;
        if (!slot.image_action_text.trim()) return `${i + 2}通目: 「メッセージを送信する」には送信されるテキストが必須です`;
      }
      if (slot.image_action_type === "message_with_phase") {
        if (!slotIsTail) return `${i + 2}通目: 「メッセージを送信する＋フェーズ遷移」は連続メッセージの最後の画像でのみ設定できます`;
        if (!slot.image_action_text.trim()) return `${i + 2}通目: 「メッセージを送信する＋フェーズ遷移」には送信されるテキストが必須です`;
        if (!slot.image_action_phase_id) return `${i + 2}通目: 「メッセージを送信する＋フェーズ遷移」には遷移先フェーズが必須です`;
        if (phases.length > 0 && !phases.some((p) => p.id === slot.image_action_phase_id)) return `${i + 2}通目: 遷移先フェーズが作品内に存在しません`;
      }
      if (slot.image_action_type === "uri") {
        const url = slot.image_action_url.trim();
        if (!url) return `${i + 2}通目: 「URLを開く」には URL が必須です`;
        if (!/^https?:\/\//i.test(url)) return `${i + 2}通目: URL は http:// または https:// から始まるものを指定してください`;
      }
    }
  }
  // ── 画像タップ時アクションバリデーション（1通目）──
  if (form.message_type === "image" && form.image_action_type) {
    // 1通目が末尾になるのは連続メッセージが無いときのみ。message アクションは末尾でのみ許可。
    const headIsTail = form.additionalMessages.length === 0;
    if (form.image_action_type === "message") {
      if (!headIsTail) return "「メッセージを送信する」は連続メッセージの最後の画像でのみ設定できます。1通目では「なし」か「URLを開く」にしてください";
      if (!form.image_action_text.trim()) return "画像タップ時アクション「メッセージを送信する」には、送信されるテキストが必須です";
    }
    if (form.image_action_type === "message_with_phase") {
      if (!headIsTail) return "「メッセージを送信する＋フェーズ遷移」は連続メッセージの最後の画像でのみ設定できます。1通目では連続メッセージが無い場合のみ設定できます";
      if (!form.image_action_text.trim()) return "「メッセージを送信する＋フェーズ遷移」には、送信されるテキストが必須です";
      if (!form.image_action_phase_id) return "「メッセージを送信する＋フェーズ遷移」には、遷移先フェーズが必須です";
      if (phases.length > 0 && !phases.some((p) => p.id === form.image_action_phase_id)) return "遷移先フェーズが作品内に存在しません";
    }
    if (form.image_action_type === "uri") {
      const url = form.image_action_url.trim();
      if (!url) return "「URLを開く」には URL が必須です";
      if (!/^https?:\/\//i.test(url)) return "URL は http:// または https:// から始まるものを指定してください";
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
  // ── 開始演出バリデーション（応答キーワード必須）──
  if (form.kind === "start" && !form.trigger_keyword.trim()) {
    return "開始演出を使用する場合は、応答キーワードを入力してください";
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
    // 謎の答え・アクション設定（複数正解: 空でない回答が最低1件必要）
    if (form.answers.every((a) => !a.trim())) return "答えは必須です（最低1件入力してください）";
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
  // 外部URL参照の動画メディア検証（サーバ PR2 と整合。external_url のときのみ保存ブロック）。
  if (form.message_type === "video") {
    const mediaErr = videoFormSaveError(form);
    if (mediaErr) return mediaErr;
  }
  // ここに到達する carousel は通常メッセージ（puzzle は上の puzzle ブロックで検証済み）。
  // 新形式をバックエンドと同じ validateCarousel で検証する。
  if (form.message_type === "carousel") {
    const err = validateCarousel({ type: "carousel", cardType: form.carousel_card_type, cards: form.carousel_cards });
    if (err) return err;
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
  /** LINEプレビュー上部に表示する OA（LINE公式アカウント）のタイトル。
   *  未取得時は作品名 → "LINEプレビュー" にフォールバックする。 */
  oaTitle?:    string;
  initialForm: MessageFormState;
  isNew:       boolean;
  submitting:  boolean;
  deleting?:   boolean;
  onSubmit:    (form: MessageFormState) => void;
  onDelete?:   () => void;
  /** 編集中メッセージの ID（新規作成時は undefined） */
  messageId?:  string;
  /** キャンセル/パンくず「メッセージ」の戻り先。未指定時は一覧トップ（元タブ保持用）。 */
  backHref?:   string;
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

// 設定ミス防止チェックの通知スタイル（warn=注意 / info=OK / muted=補足）。保存はブロックしない。
const checkNotice: Record<"warn" | "info" | "muted", React.CSSProperties> = {
  warn:  { fontSize: 12, lineHeight: 1.6, fontWeight: 600, padding: "8px 10px", borderRadius: 6, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" },
  info:  { fontSize: 12, lineHeight: 1.6, fontWeight: 600, padding: "8px 10px", borderRadius: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" },
  muted: { fontSize: 12, lineHeight: 1.6, padding: "8px 10px", borderRadius: 6, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" },
};

// エラー（赤）通知スタイル（保存ブロック相当の表示）。
const errorNotice: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.6, fontWeight: 600, padding: "8px 10px", borderRadius: 6,
  background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
};

const VIDEO_USAGE_OPTIONS: { value: "line_video" | "liff_playback" | "cms_preview"; label: string; help: string }[] = [
  { value: "line_video",    label: "LINEトークに動画として送信", help: "mp4・200MB以下・JPEG/PNG サムネイル必須" },
  { value: "liff_playback", label: "LIFFページ/外部ページで再生", help: "200MB超も可。LINEトークではリンク誘導になります" },
  { value: "cms_preview",   label: "CMSプレビューのみ",          help: "LINE動画としては送信されません" },
];

/**
 * 動画メッセージのメディア設定欄（PR3）。
 * - メディアソース（アップロード / 外部URL）
 * - 動画URL（外部URL時は手入力・アップロード時は MediaUploadButton）
 * - サムネイルURL（LINE video 用途では必須。アップロード動画でも設定可）
 * - 用途セレクト（line_video / liff_playback / cms_preview）
 * - サイズ確認（/api/media/probe = HEAD）
 * - 用途別バリデーション表示（media-validation.ts と整合）
 * 既存の画像/テキスト等には触れない。
 */
function VideoMediaSection({ form, set, oaId, workId }: {
  form: MessageFormState;
  set:  <K extends keyof MessageFormState>(k: K, v: MessageFormState[K]) => void;
  oaId: string;
  workId: string;
}) {
  const [probing, setProbing] = useState(false);
  const [videoProbeMsg,   setVideoProbeMsg]   = useState<{ level: "warn" | "info" | "muted"; text: string } | null>(null);
  const [previewProbeMsg, setPreviewProbeMsg] = useState<{ level: "warn" | "info" | "muted"; text: string } | null>(null);

  const source     = form.asset_media_source === "external_url" ? "external_url" : "upload";
  const isExternal = source === "external_url";
  const usage      = resolveVideoUsage(form); // "" → line_video 相当
  const issues     = resolveVideoFormIssues(form);
  const previewSet = !!form.asset_preview_url.trim();

  async function runProbe(url: string, target: "video" | "preview") {
    const u = url.trim();
    const setMsg = target === "video" ? setVideoProbeMsg : setPreviewProbeMsg;
    if (!u) { setMsg({ level: "warn", text: "URL を入力してください" }); return; }
    setProbing(true);
    setMsg(null);
    try {
      const token = getDevToken();
      const res = await uploadApi.probeMedia(token, u);
      if (target === "video") {
        // 取得できた mime / size をフォームへ反映（既知のときのみ上書き＝手入力値を尊重）。
        if (res.mimeType) set("asset_mime_type", res.mimeType);
        if (res.sizeKnown && res.sizeBytes != null) set("asset_file_size_bytes", String(res.sizeBytes));
      }
      if (!res.sizeKnown) {
        setMsg({ level: "warn", text: `Content-Type: ${res.mimeType ?? "不明"} / サイズ: 取得できませんでした（${res.error === "timeout" ? "タイムアウト" : "HEAD 非対応/Content-Length なし"}）。サイズ不明のまま保存できますが、LINE 仕様の上限超過の可能性があります。` });
        return;
      }
      const bytes = Number(res.sizeBytes);
      const mb = bytes / 1024 / 1024;
      const overVideo   = target === "video"   && usage === "line_video" && bytes > 200 * 1024 * 1024;
      const overPreview = target === "preview" && bytes > 1024 * 1024;
      const ok = !overVideo && !overPreview;
      setMsg({
        level: ok ? "info" : "warn",
        text: `Content-Type: ${res.mimeType ?? "不明"} / サイズ: ${mb.toFixed(2)} MB`
          + (overVideo   ? " — LINE動画メッセージの上限 200MB を超えています（このままでは送信できません）" : "")
          + (overPreview ? " — サムネイルの上限 1MB を超えています" : "")
          + (ok ? " — LINE 仕様上 OK" : ""),
      });
    } catch (e) {
      setMsg({ level: "warn", text: `サイズ確認に失敗しました（${e instanceof Error ? e.message : "unknown"}）` });
    } finally {
      setProbing(false);
    }
  }

  const probeBtnStyle: React.CSSProperties = {
    marginTop: 6, fontSize: 12, padding: "4px 10px", borderRadius: 6,
    border: "1px solid #cbd5e1", background: "#fff", color: "#334155", cursor: probing ? "default" : "pointer",
  };

  return (
    <>
      {/* ── メディアソース ── */}
      <div className="form-group">
        <label style={fieldLabel}>動画の指定方法</label>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio"
              name="asset_media_source"
              checked={source === "upload"}
              onChange={() => set("asset_media_source", "upload")}
            />
            アップロード
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio"
              name="asset_media_source"
              checked={source === "external_url"}
              onChange={() => set("asset_media_source", "external_url")}
            />
            外部URL
          </label>
        </div>
        <div style={hintText}>
          外部URL: 大容量動画を外部ストレージ/CDN に置き、Whale Studio には URL とメタのみ保存します（本体は保存しません）。
        </div>
      </div>

      {/* ── 動画URL ── */}
      <div className="form-group">
        <label style={fieldLabel} htmlFor="asset_url_video">
          動画 URL <RequiredMark />
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
        {/* アップロード選択時のみ直接アップロード（既存挙動）。成功で URL 欄へ反映し source=upload を明示。 */}
        {source === "upload" && (
          <MediaUploadButton
            mediaType="video"
            oaId={oaId}
            workId={workId}
            onUploaded={(url) => { set("asset_url", url); set("asset_media_source", "upload"); }}
          />
        )}
        <div>
          <button type="button" style={probeBtnStyle} disabled={probing} onClick={() => runProbe(form.asset_url, "video")}>
            {probing ? "確認中…" : "サイズ確認"}
          </button>
        </div>
        {videoProbeMsg && <div style={{ ...checkNotice[videoProbeMsg.level], marginTop: 6 }}>{videoProbeMsg.text}</div>}
        {/* 再生確認用プレーヤー（http(s) URL のときのみ）。サムネがあれば poster に使う。 */}
        {/^https?:\/\//i.test(form.asset_url.trim()) && (
          <div style={{ marginTop: 10 }}>
            <div style={hintText}>プレビュー（再生確認）</div>
            <video
              key={form.asset_url}
              src={form.asset_url.trim()}
              poster={form.asset_preview_url.trim() || undefined}
              controls
              preload="metadata"
              style={{ width: "100%", maxWidth: 320, marginTop: 4, borderRadius: 8, background: "#000" }}
            >
              お使いのブラウザは動画の再生に対応していません。
            </video>
          </div>
        )}
      </div>

      {/* ── サムネイルURL ── */}
      <div className="form-group">
        <label style={fieldLabel} htmlFor="asset_preview_url_video">
          サムネイル画像 URL（LINE動画のプレビュー）{usage === "line_video" ? <RequiredMark /> : <span style={{ color: "#9ca3af", fontWeight: 400 }}>（任意）</span>}
        </label>
        <input
          id="asset_preview_url_video"
          type="url"
          className="form-input"
          value={form.asset_preview_url}
          onChange={(e) => set("asset_preview_url", e.target.value)}
          placeholder="https://example.com/thumbnail.jpg"
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
        <div style={hintText}>
          LINE動画メッセージの previewImageUrl に使用（JPEG/PNG・最大1MB）。アップロード動画でも設定できます。
        </div>
        <div>
          <button type="button" style={probeBtnStyle} disabled={probing} onClick={() => runProbe(form.asset_preview_url, "preview")}>
            {probing ? "確認中…" : "サムネのサイズ確認"}
          </button>
        </div>
        {previewProbeMsg && <div style={{ ...checkNotice[previewProbeMsg.level], marginTop: 6 }}>{previewProbeMsg.text}</div>}
        {/^https?:\/\//i.test(form.asset_preview_url.trim()) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.asset_preview_url.trim()}
            alt="サムネイルプレビュー"
            style={{ maxWidth: 160, marginTop: 8, borderRadius: 6, border: "1px solid #e5e7eb" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>

      {/* ── 用途 ── */}
      <div className="form-group">
        <label style={fieldLabel} htmlFor="asset_usage_video">用途</label>
        <select
          id="asset_usage_video"
          className="form-input"
          value={form.asset_usage || "line_video"}
          onChange={(e) => set("asset_usage", e.target.value)}
        >
          {VIDEO_USAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={hintText}>{VIDEO_USAGE_OPTIONS.find((o) => o.value === usage)?.help}</div>
      </div>

      {/* ── バリデーション表示（media-validation と整合）──
           external_url は error を赤（保存ブロック）。upload/既存は保存を止めないため warning 表示に寄せる。 */}
      {issues.map((iss, i) => {
        const asError = isExternal && iss.level === "error";
        return (
          <div key={`${iss.code}-${i}`} style={{ ...(asError ? errorNotice : checkNotice.warn), marginBottom: 8 }}>
            {iss.message}
          </div>
        );
      })}

      {/* 既存/アップロード動画で LINE video 用途かつサムネ未設定のときの明示（保存は可・送信はリンク誘導）。 */}
      {!isExternal && usage === "line_video" && !previewSet && (
        <div style={{ ...checkNotice.warn, marginBottom: 8 }}>
          サムネイル未設定のため、この動画は LINE トークでは動画メッセージとして送信されず、リンク誘導になります。
          LINE動画として送るには、上のサムネイル画像 URL を設定してください（後から追加できます）。
        </div>
      )}
      {usage === "liff_playback" && (
        <div style={{ ...checkNotice.muted, marginBottom: 8 }}>
          LIFF再生用途です。LINEトークでは動画メッセージにならず、リンク誘導として扱われます。
        </div>
      )}
      {usage === "cms_preview" && (
        <div style={{ ...checkNotice.muted, marginBottom: 8 }}>
          CMSプレビュー用途です。LINE動画としては送信されません。
        </div>
      )}
    </>
  );
}

// 長めの補足説明を「詳細」トグルに畳む（UI のみ・既定は閉じる）。
// 警告/エラーに見えないよう、トグル・本文とも薄いグレー・本文より控えめなサイズにする。
function HelpDetails({ children, label = "詳細" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 3 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "inline-flex", alignItems: "center", gap: 3, padding: 0,
          background: "none", border: "none", cursor: "pointer",
          fontSize: 11, color: "#9ca3af", fontWeight: 500,
        }}
      >
        {label}<span style={{ fontSize: 8 }} aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 3, fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
          {children}
        </div>
      )}
    </div>
  );
}

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
// HintListEditor — 問題メッセージのヒント設定（フラット表示）
//   incorrect_quick_replies（action="hint"）を、囲いの少ない縦並びで編集する。
//   保存形式は QuickReplyItem のまま（hint_text / hint_followup / hint_character_id /
//   hint_next_label / hint_cancel_label）。runtime / 送信 payload には触れない。
// ────────────────────────────────────────────────────────

/** ヒント1項目内の「ラベル＋入力」行。 */
function HintField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-group" style={{ marginBottom: 8 }}>
      <label style={{ ...fieldLabel, fontSize: 12 }}>{label}</label>
      {children}
    </div>
  );
}

function HintListEditor({ items, onChange, characters }: {
  items:      QuickReplyItem[];
  onChange:   (items: QuickReplyItem[]) => void;
  characters: Character[];
}) {
  // スイッチ OFF 時にラベルを「一時退避」しておき、再 ON で復元する（保存形式は変えない＝OFF のまま保存なら空）。
  // index 揃えで管理（add/remove で同期。このエディタには並べ替え UI が無いため index は安定）。
  const [stashNext,   setStashNext]   = useState<string[]>([]);
  const [stashCancel, setStashCancel] = useState<string[]>([]);

  const update = (i: number, patch: Partial<QuickReplyItem>) =>
    onChange(items.map((it, ii) => (ii === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => {
    onChange(items.filter((_, ii) => ii !== i));
    setStashNext((s)   => s.filter((_, ii) => ii !== i));
    setStashCancel((s) => s.filter((_, ii) => ii !== i));
  };
  const add = () => {
    onChange([...items, { label: "", action: "hint", hint_text: "", hint_followup: "", hint_character_id: null } as QuickReplyItem]);
    setStashNext((s)   => [...s, ""]);
    setStashCancel((s) => [...s, ""]);
  };

  // OFF: 現在のラベルを退避してフォーム値を空に（入力欄は非表示）。ON: 退避値があれば復元、無ければ既定文言。
  const toggleNext = (i: number, on: boolean) => {
    if (on) {
      const restored = (stashNext[i] ?? "").trim() || (items[i]?.hint_next_label ?? "") || "さらにヒント";
      update(i, { hint_next_label: restored });
    } else {
      setStashNext((s) => { const n = [...s]; n[i] = items[i]?.hint_next_label ?? ""; return n; });
      update(i, { hint_next_label: undefined });
    }
  };
  const toggleCancel = (i: number, on: boolean) => {
    if (on) {
      const restored = (stashCancel[i] ?? "").trim() || (items[i]?.hint_cancel_label ?? "") || "問題にもどる";
      update(i, { hint_cancel_label: restored });
    } else {
      setStashCancel((s) => { const n = [...s]; n[i] = items[i]?.hint_cancel_label ?? ""; return n; });
      update(i, { hint_cancel_label: undefined });
    }
  };

  const inputStyle: React.CSSProperties = { fontSize: 13 };

  return (
    <div className="form-group">
      <label style={fieldLabel}>
        ヒント（クイックリプライ）
        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#6b7280", background: "#f1f5f9", borderRadius: 4, padding: "1px 6px" }}>任意</span>
      </label>
      <div style={{ ...hintText, marginBottom: 12 }}>
        問題にヒントを付けると、LINE上でクイックリプライとして表示されます。
      </div>

      {items.map((item, i) => {
        const hasNext   = !!(item.hint_next_label && item.hint_next_label.length > 0);
        const hasCancel = !!(item.hint_cancel_label && item.hint_cancel_label.length > 0);
        return (
          <div key={i} style={{ paddingTop: i === 0 ? 0 : 14, marginTop: i === 0 ? 0 : 14, borderTop: i === 0 ? "none" : "1px solid #eef0f2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>ヒント{items.length > 1 ? i + 1 : ""}</span>
              <button type="button" className="btn btn-ghost"
                style={{ padding: "1px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }}
                onClick={() => remove(i)}>削除</button>
            </div>

            <HintField label="ボタンテキスト">
              <input type="text" className="form-input" style={inputStyle} maxLength={20}
                value={item.label ?? ""} placeholder={items.length === 1 ? "ヒント" : `ヒント${i + 1}`}
                onChange={(e) => update(i, { label: e.target.value })} />
            </HintField>

            <HintField label="応答キャラクター">
              <select className="form-input" style={inputStyle}
                value={item.hint_character_id ?? ""}
                onChange={(e) => update(i, { hint_character_id: e.target.value || null })}>
                <option value="">（本文と同じ / デフォルト）</option>
                {characters.map((ch) => (<option key={ch.id} value={ch.id}>{ch.name}</option>))}
              </select>
            </HintField>

            <HintField label="ヒント本文">
              <textarea className="form-input" rows={2} maxLength={2000} style={{ ...inputStyle, resize: "vertical" }}
                value={item.hint_text ?? ""}
                onChange={(e) => update(i, { hint_text: e.target.value || undefined })} />
            </HintField>

            <HintField label="回答誘導メッセージ">
              <textarea className="form-input" rows={2} maxLength={500} style={{ ...inputStyle, resize: "vertical" }}
                value={item.hint_followup ?? ""}
                onChange={(e) => update(i, { hint_followup: e.target.value || undefined })} />
            </HintField>

            <QrHintPreview hintText={item.hint_text} hintFollowup={item.hint_followup} />

            {/* さらにヒント（ON で追加のボタンテキスト入力欄を表示） */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Switch checked={hasNext} ariaLabel="さらにヒント"
                  onChange={(on) => toggleNext(i, on)} />
                <span style={{ fontSize: 12, color: "#374151" }}>さらにヒント</span>
              </div>
              {hasNext && (
                <div style={{ marginTop: 6 }}>
                  <HintField label="ボタンテキスト">
                    <input type="text" className="form-input" style={inputStyle} maxLength={20}
                      value={item.hint_next_label ?? ""} placeholder="さらにヒント"
                      onChange={(e) => update(i, { hint_next_label: e.target.value || undefined })} />
                  </HintField>
                </div>
              )}
            </div>

            {/* 問題にもどる（ON で追加のボタンテキスト入力欄を表示） */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Switch checked={hasCancel} ariaLabel="問題にもどる"
                  onChange={(on) => toggleCancel(i, on)} />
                <span style={{ fontSize: 12, color: "#374151" }}>問題にもどる</span>
              </div>
              {hasCancel && (
                <div style={{ marginTop: 6 }}>
                  <HintField label="ボタンテキスト">
                    <input type="text" className="form-input" style={inputStyle} maxLength={20}
                      value={item.hint_cancel_label ?? ""} placeholder="問題にもどる"
                      onChange={(e) => update(i, { hint_cancel_label: e.target.value || undefined })} />
                  </HintField>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px", marginTop: 12 }}
        onClick={add}>
        ＋ヒント（クイックリプライ）追加
      </button>
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
  /** 直接URL入力モードの URL候補（LIFF / ロケーションURL）。選択結果だけが value に入る。 */
  linkOptions?: LinkOption[];
  linkOptionsLiffConfigured?: boolean;
  /** 見出し（既定: "クイックリプライ設定"）。謎/問題モードのヒント設定では "ヒント設定" を渡す。 */
  heading?: string;
  /** ヒント設定エリアでは「ヒントボタンにする」トグルを隠し、各項目を既定でヒント扱いにする。 */
  hideHintToggle?: boolean;
  /** 編集中メッセージのフェーズ ID。Step3=メッセージで別フェーズ遷移先を選んだ警告判定に使う。 */
  currentPhaseId?: string | null;
}

function QuickReplyEditor({ items, onChange, responseMessages, phases, transitionMessages, characters = [], workId, oaId, destinations = [], allMessages = [], linkOptions, linkOptionsLiffConfigured, heading = "クイックリプライ設定", hideHintToggle = false, currentPhaseId = null }: QuickReplyEditorProps) {
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
    // ヒント設定エリア（hideHintToggle）では新規項目を既定でヒント扱いにする（トグル非表示のため）。
    onChange([...items, hideHintToggle ? { ...EMPTY_QR, action: "hint" } : { ...EMPTY_QR }]);
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
            {heading}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, background: "var(--color-line-2, #f0f3f1)", color: "var(--color-ink-3, #9aa8a2)",
            borderRadius: 4, padding: "1px 6px",
          }}>任意</span>
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
                            <div style={{ fontWeight: 600, color: "#334155", marginBottom: 2 }}>クイックリプライタップ時の処理フロー</div>
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
                            ボタンテキスト <RequiredMark />
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
                              linkOptions={linkOptions}
                              linkOptionsLiffConfigured={linkOptionsLiffConfigured}
                              onModeChange={(m) => {
                                if (m === "destination") updateItem(index, { value: undefined } as Partial<QuickReplyItem>);
                                if (m === "direct_url") updateItem(index, { destination_id: undefined } as Partial<QuickReplyItem>);
                                if (m === "none") updateItem(index, { destination_id: undefined, value: undefined } as Partial<QuickReplyItem>);
                              }}
                              onDestinationChange={(id) => updateItem(index, { destination_id: id } as Partial<QuickReplyItem>)}
                              onDirectUrlChange={(url) => updateItem(index, { value: url } as Partial<QuickReplyItem>)}
                              onPickLink={(url) => updateItem(index, { value: url, destination_id: undefined } as Partial<QuickReplyItem>)}
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
                              クイックリプライタップ直後に返す応答メッセージです。<strong>応答メッセージ（種別=応答）のみ選択できます</strong>。
                              ここでメッセージを返しても、プレイヤーのフェーズはまだ変わりません。
                              フェーズの通常メッセージ・入場メッセージへ進めたい場合は、Step 3 で「フェーズ遷移」を選択してください。
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
                                const lblMap   = { none: "なし", message: "指定メッセージ送信", phase: "フェーズ遷移" } as const;
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
                                {/* C/D: 別フェーズのメッセージを指定した場合の警告（メッセージ遷移では currentPhase が進まない）。 */}
                                {isQrCrossPhaseMessageTarget({
                                  targetType: "message",
                                  targetMessageId: item.target_message_id,
                                  transitionMessages,
                                  currentPhaseId,
                                }) && (() => {
                                  const tphId = resolveQrTargetMessagePhaseId(item.target_message_id, transitionMessages);
                                  const tphName = (phases ?? []).find((p) => p.id === tphId)?.name ?? "別フェーズ";
                                  const curName = (phases ?? []).find((p) => p.id === currentPhaseId)?.name;
                                  return (
                                    <div style={{ marginTop: 6, padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11, lineHeight: 1.6, color: "#92400e" }}>
                                      ⚠ 選択したメッセージは別フェーズ「{tphName}」にあります。
                                      メッセージ遷移ではプレイヤーの現在のフェーズは変わらないため、そのフェーズの応答キーワードは反応しません。
                                      {curName
                                        ? `フェーズ「${tphName}」へ進めたい場合は、遷移先を「フェーズ遷移」にして「${tphName}」を選択してください。`
                                        : "次フェーズへ進めたい場合は、遷移先を「フェーズ遷移」に変更してください。"}
                                    </div>
                                  );
                                })()}
                              </>
                            )}

                            {/* モード別の説明（正解時アクションの語彙に合わせる）。 */}
                            {getQrTransitionType(item) === "none" && (
                              <div style={{ ...hintText }}>
                                遷移先なし — Step 2 の応答メッセージだけを返して終了します（フェーズはそのまま）。
                              </div>
                            )}
                            {getQrTransitionType(item) === "message" && (
                              <div style={{ ...hintText, marginTop: 4 }}>
                                選んだメッセージから、クイックリプライ・自由入力・終端で止まるまでの<strong>連続メッセージ</strong>を送信します。<strong>別フェーズのメッセージを選んでも、プレイヤーの現在のフェーズは変わりません</strong>。
                                次のフェーズへ進めたい場合は「フェーズ遷移」を選択してください。
                              </div>
                            )}
                            {getQrTransitionType(item) === "phase" && (
                              <div style={{ ...hintText, marginTop: 4 }}>
                                フェーズ遷移を選ぶと、<strong>プレイヤーの現在のフェーズが選択したフェーズに更新され</strong>、そのフェーズのメッセージが送信されます。
                                このフェーズ内の応答キーワードが有効になります。
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
                                      ℹ️ このクイックリプライは<strong>指定メッセージの連続メッセージのみ</strong>送信します。同じフェーズ内の後続メッセージは自動では送信されません（続けたい場合は クイックリプライ / 自由入力 / フェーズ遷移で明示的に接続してください）。
                                    </div>
                                  )}
                                  <div style={{ fontWeight: 700, color: "#475569" }}>
                                    {pv.mode === "phase_entry"
                                      ? <>入場時に送信されるメッセージ: {pv.total}通<span style={{ fontWeight: 400, color: "#94a3b8" }}>（最初のクイックリプライ / 入力待ちまで）</span></>
                                      : <>このクイックリプライで送信されるメッセージ: {pv.total}通</>}
                                  </div>
                                  {pv.mode === "phase_entry" && (() => {
                                    const totalInPhase = allMessages.filter((m) => m.phase_id === item.target_phase_id).length;
                                    return totalInPhase > pv.total ? (
                                      <div style={{ fontWeight: 400, color: "#94a3b8", fontSize: 10, marginTop: 2 }}>
                                        フェーズ内の総メッセージ: {totalInPhase}通（残りは入場後のクイックリプライ選択・進行で順次送信されます）
                                      </div>
                                    ) : null;
                                  })()}
                                  <ol style={{ margin: "4px 0 0", paddingLeft: 18, color: "#475569" }}>
                                    {pv.messages.map((mm) => (
                                      <li key={mm.id}>{(mm.body ?? `(${mm.message_type ?? "?"})`).replace(/\n/g, " ").slice(0, 24)}</li>
                                    ))}
                                  </ol>
                                  {/* 送信先メッセージに付く「次のクイックリプライ」（= タップ後に LINE 実機で表示される QR）。
                                      実機では「現在のQR」をタップ → 上記メッセージが送信され、その末尾にこの QR が出る。
                                      CMS上は現在メッセージ直下に QR が見えるが、実機ではこの位置に出ることを明示する。 */}
                                  {pv.destinationTailQr.length > 0 && (
                                    <>
                                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
                                        <span style={{ color: "#475569", fontWeight: 700 }}>送信先メッセージに付くクイックリプライ:</span>
                                        {pv.destinationTailQr.map((qr, qi) => (
                                          <span key={qi} style={QR_TAIL_CHIP_STYLE}>
                                            {qr.label || <span style={{ fontStyle: "italic", opacity: 0.6 }}>ラベル未入力</span>}
                                          </span>
                                        ))}
                                      </div>
                                      <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 10, lineHeight: 1.6 }}>
                                        実機ではこのクイックリプライをタップすると上記メッセージが送信され、その<strong>最後にこの次のクイックリプライ</strong>が表示されます（現在のメッセージ直下に出続けるわけではありません）。
                                      </div>
                                    </>
                                  )}
                                  {pv.overLimit && pv.overflowKind === "dropped" && (
                                    <div style={{ marginTop: 6, color: "#b91c1c" }}>
                                      ⚠️ この連続メッセージは{pv.fullTotal}通あり、5通を超えています。<strong>6通目以降は送信されません</strong>（1チェーン最大5通）。5通以内に分割するか、クイックリプライ / 自由入力 / フェーズ遷移で区切ってください。
                                    </div>
                                  )}
                                  {pv.overLimit && pv.overflowKind === "push" && (
                                    <div style={{ marginTop: 6, color: "#b91c1c" }}>
                                      ⚠️ この送信は合計{pv.total}通で、5通を超えています。<strong>6通目以降は Push 送信</strong>となり、月間上限などにより届かない可能性があります。クイックリプライ / 自由入力 / フェーズ遷移で5通以内に区切ることをおすすめします。
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* ヒントボタントグル（ヒント設定エリアでは文脈上自明なため非表示） */}
                        {!hideHintToggle && (
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
                        )}

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
                                ヒント本文 <RequiredMark />
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
            🔗 クイックリプライから自動連携（保存時にキーワードへ追加されます）
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
                  title={alreadyManual ? "手動キーワードにも設定済み" : "クイックリプライ連携ラベル"}
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

// ── カルーセル（カードタイプ式）エディタ / プレビュー ─────────────
//   通常メッセージの message_type="carousel" 用（謎/puzzle カルーセルは別実装・旧 carousel_items）。
const CAROUSEL_CARD_TYPE_LABEL: Record<CarouselCardType, string> = {
  product: "プロダクト", location: "ロケーション", person: "パーソン", image: "イメージ",
};

function carouselCardHasContent(c: CarouselCard): boolean {
  return !!((c.imageUrl || c.title || c.name || c.description || c.price || c.address || c.extraInfo
    || c.action?.label || c.action?.url || c.action?.text || "").trim?.());
}

/** カード内の 1 行テキスト入力（任意/必須・textarea 切替）。 */
function CardField({ label, value, onChange, required, textarea }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; textarea?: boolean;
}) {
  return (
    <div className="form-group" style={{ marginBottom: 8 }}>
      <label style={{ ...fieldLabel, fontSize: 11 }}>{label}{required && <RequiredMark />}</label>
      {textarea
        ? <textarea className="form-input" rows={2} style={{ fontSize: 12, resize: "vertical" }} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" className="form-input" style={{ fontSize: 12 }} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

/** カードのアクション編集（ラベル必須・URL/テキスト切替）。 */
function CarouselActionEditor({ action, onChange }: { action: CarouselAction; onChange: (patch: Partial<CarouselAction>) => void; }) {
  return (
    <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px dashed #e5e7eb" }}>
      <CardField label="アクションラベル" required value={action.label ?? ""} onChange={(v) => onChange({ label: v })} />
      <div className="form-group" style={{ marginBottom: 8 }}>
        <label style={{ ...fieldLabel, fontSize: 11 }}>アクションタイプ</label>
        <div style={{ display: "flex", gap: 3, background: "#f3f4f6", borderRadius: 6, padding: 2 }}>
          {(["url", "text"] as CarouselActionType[]).map((t) => {
            const active = action.type === t;
            return (
              <button key={t} type="button" onClick={() => onChange({ type: t })}
                style={{ flex: 1, padding: "4px 0", fontSize: 11, fontWeight: active ? 700 : 400, border: "none", borderRadius: 5,
                  background: active ? "#fff" : "transparent", color: active ? "#111827" : "#9ca3af", cursor: "pointer" }}>
                {t === "url" ? "URL" : "テキスト"}
              </button>
            );
          })}
        </div>
      </div>
      {action.type === "url"
        ? <CardField label="URL" required value={action.url ?? ""} onChange={(v) => onChange({ url: v })} />
        : <CardField label="送信テキスト" required textarea value={action.text ?? ""} onChange={(v) => onChange({ text: v })} />}
    </div>
  );
}

/** 通常メッセージ carousel のカード編集（タイプ選択 + タイプ別項目 + アクション + 最大5枚）。 */
function CarouselCardsEditor({ cardType, cards, onChange, disabled = false }: {
  cardType: CarouselCardType; cards: CarouselCard[];
  onChange: (cardType: CarouselCardType, cards: CarouselCard[]) => void; disabled?: boolean;
}) {
  const setCards = (next: CarouselCard[]) => onChange(cardType, next);
  const updateCard = (i: number, patch: Partial<CarouselCard>) => setCards(cards.map((c, ii) => (ii === i ? { ...c, ...patch } : c)));
  const updateAction = (i: number, patch: Partial<CarouselAction>) => updateCard(i, { action: { ...cards[i].action, ...patch } });

  const changeCardType = (next: CarouselCardType) => {
    if (next === cardType || disabled) return;
    if (cards.some(carouselCardHasContent) &&
        !window.confirm("カードタイプを変更すると、現在入力中のカード内容がリセットされます。変更しますか？")) return;
    onChange(next, [emptyCarouselCard(next)]); // OK のときのみそのタイプの初期カードへリセット
  };
  const addCard = () => { if (!disabled && cards.length < CAROUSEL_MAX_CARDS) setCards([...cards, emptyCarouselCard(cardType)]); };
  const removeCard = (i: number) => {
    const next = cards.filter((_, ii) => ii !== i);
    setCards(next.length === 0 ? [emptyCarouselCard(cardType)] : next); // 最後の1枚を消したら空カードを自動追加（最低1枚）
  };
  const overLimit = cards.length > CAROUSEL_MAX_CARDS; // 旧データで5枚超のケース（壊さず表示・新規追加のみ不可）

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label style={fieldLabel}>カードタイプ <RequiredMark /></label>
      <div style={{ display: "flex", gap: 3, background: "#f3f4f6", borderRadius: 8, padding: 3, marginBottom: 8 }}>
        {CAROUSEL_CARD_TYPES.map((t) => {
          const active = t === cardType;
          return (
            <button key={t} type="button" disabled={disabled} onClick={() => changeCardType(t)}
              style={{ flex: 1, padding: "6px 0", fontSize: 12, fontWeight: active ? 700 : 400, border: "none", borderRadius: 6,
                background: active ? "#fff" : "transparent", color: active ? "#111827" : "#9ca3af",
                cursor: disabled ? "default" : "pointer", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
              {CAROUSEL_CARD_TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>
      <div style={{ ...hintText, marginBottom: 10 }}>
        1つのカルーセル内ではカードタイプは1種類です。カルーセルカードは最大{CAROUSEL_MAX_CARDS}枚まで追加できます。
      </div>

      <label style={fieldLabel}>
        カード <RequiredMark />
        <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>({cards.length} / {CAROUSEL_MAX_CARDS}枚)</span>
      </label>
      {overLimit && (
        <div style={{ ...hintText, color: "#b45309", marginBottom: 6 }}>
          ⚠ 5枚を超えています。送信時は先頭5枚のみ送られます（新規追加は不可）。
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
        {cards.map((card, i) => (
          <div key={i} style={{ padding: 12, border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>カード {i + 1}</span>
              <button type="button" className="btn btn-ghost" style={{ padding: "1px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }}
                onClick={() => removeCard(i)}>削除</button>
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label style={{ ...fieldLabel, fontSize: 11 }}>画像</label>
              <ImageUploader value={card.imageUrl ?? ""} onChange={(url) => updateCard(i, { imageUrl: url })} disabled={disabled} />
            </div>

            {cardType === "product" && (<>
              <CardField label="名前（任意）" value={card.name ?? ""} onChange={(v) => updateCard(i, { name: v })} />
              <CardField label="タイトル" required value={card.title ?? ""} onChange={(v) => updateCard(i, { title: v })} />
              <CardField label="説明文（任意）" textarea value={card.description ?? ""} onChange={(v) => updateCard(i, { description: v })} />
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label style={{ ...fieldLabel, fontSize: 11 }}>価格（任意）</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select className="form-input" style={{ width: 64, fontSize: 12 }} value={card.priceCurrency || "¥"} onChange={(e) => updateCard(i, { priceCurrency: e.target.value })}>
                    <option value="¥">¥</option>
                  </select>
                  <input type="text" className="form-input" style={{ fontSize: 12 }} placeholder="00,000" value={card.price ?? ""} onChange={(e) => updateCard(i, { price: e.target.value })} />
                </div>
                <div style={{ ...hintText, marginTop: 2 }}>表示例: ¥00,000</div>
              </div>
            </>)}
            {cardType === "location" && (<>
              <CardField label="タイトル" required value={card.title ?? ""} onChange={(v) => updateCard(i, { title: v })} />
              <CardField label="住所（任意）" value={card.address ?? ""} onChange={(v) => updateCard(i, { address: v })} />
              <CardField label="追加情報（任意）" value={card.extraInfo ?? ""} onChange={(v) => updateCard(i, { extraInfo: v })} />
            </>)}
            {cardType === "person" && (<>
              <CardField label="名前" required value={card.name ?? ""} onChange={(v) => updateCard(i, { name: v })} />
              <CardField label="説明（任意）" textarea value={card.description ?? ""} onChange={(v) => updateCard(i, { description: v })} />
            </>)}
            {/* image: 追加フィールドなし（画像 + アクションのみ） */}

            <CarouselActionEditor action={card.action} onChange={(patch) => updateAction(i, patch)} />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px", opacity: cards.length >= CAROUSEL_MAX_CARDS ? 0.5 : 1 }}
        disabled={disabled || cards.length >= CAROUSEL_MAX_CARDS} onClick={addCard}>
        ＋ カードを追加
      </button>
    </div>
  );
}

const PREVIEW_ELLIPSIS = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** 管理画面プレビュー: 4 カードタイプを見分けられる横スクロールカード列。 */
function CarouselCardsPreview({ cardType, cards }: { cardType: CarouselCardType; cards: CarouselCard[] }) {
  if (!cards || cards.length === 0) return <span style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>カードを追加してください</span>;
  const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => { (e.target as HTMLImageElement).style.display = "none"; };
  return (
    <div style={{ overflowX: "auto", display: "flex", gap: 8, paddingBottom: 4 }}>
      {cards.slice(0, CAROUSEL_MAX_CARDS).map((card, idx) => {
        const img = (card.imageUrl ?? "").trim();
        const label = (card.action?.label ?? "").trim();
        return (
          <div key={idx} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, width: 144, flexShrink: 0, overflow: "hidden" }}>
            {cardType === "person" ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
                {img
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={img} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} onError={hideOnError} />
                  : <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#9ca3af" }}>👤</div>}
              </div>
            ) : (
              img
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={img} alt="" style={{ width: "100%", height: cardType === "image" ? 104 : 78, objectFit: "cover", display: "block" }} onError={hideOnError} />
                : <div style={{ width: "100%", height: cardType === "image" ? 104 : 60, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#9ca3af" }}>🖼</div>
            )}
            <div style={{ padding: "6px 8px" }}>
              {cardType === "product" && (<>
                {card.name?.trim() && <div style={{ fontSize: 8, color: "#8c8c8c", ...PREVIEW_ELLIPSIS }}>{card.name}</div>}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#111", ...PREVIEW_ELLIPSIS }}>{card.title?.trim() || `カード ${idx + 1}`}</div>
                {card.description?.trim() && <div style={{ fontSize: 9, color: "#555", ...PREVIEW_ELLIPSIS }}>{card.description}</div>}
                {card.price?.trim() && <div style={{ fontSize: 10, fontWeight: 700, color: "#111", marginTop: 2 }}>{(card.priceCurrency || "¥")}{card.price}</div>}
              </>)}
              {cardType === "location" && (<>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#111", ...PREVIEW_ELLIPSIS }}>{card.title?.trim() || `カード ${idx + 1}`}</div>
                {card.address?.trim() && <div style={{ fontSize: 9, color: "#555", ...PREVIEW_ELLIPSIS }}>📍 {card.address}</div>}
                {card.extraInfo?.trim() && <div style={{ fontSize: 9, color: "#8c8c8c", ...PREVIEW_ELLIPSIS }}>ℹ️ {card.extraInfo}</div>}
              </>)}
              {cardType === "person" && (<>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#111", textAlign: "center", ...PREVIEW_ELLIPSIS }}>{card.name?.trim() || `カード ${idx + 1}`}</div>
                {card.description?.trim() && <div style={{ fontSize: 9, color: "#555", textAlign: "center", ...PREVIEW_ELLIPSIS }}>{card.description}</div>}
              </>)}
              {/* image: テキストなし */}
              {label && <div style={{ marginTop: 6, padding: "4px 6px", background: "#06C755", color: "#fff", borderRadius: 4, fontSize: 9, textAlign: "center", ...PREVIEW_ELLIPSIS }}>{label}</div>}
            </div>
          </div>
        );
      })}
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
  /** トーク画面上部に表示する OA（LINE公式アカウント）のタイトル。
   *  未取得時は作品名 → "LINEプレビュー" の順でフォールバックする。 */
  oaTitle?:     string;
  /** OAタイトル未取得時のフォールバックに使う作品名。 */
  workTitle?:   string;
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
      // タップ時の動作（image_action）をプレビュー表示。旧 tap_* 由来の表示は出さない。
      const at = item.image_action_type;
      const tapText = (item.image_action_text ?? "").trim() || "未入力";
      const tapHint =
        at === "uri"     ? `タップ時: URLを開く（${(item.image_action_url ?? "").trim() || "未入力"}）`
        : at === "message" ? `タップ時: メッセージを送信（${tapText}）`
        : at === "message_with_phase" ? `タップ時: メッセージを送信＋フェーズ遷移（${tapText}${item.image_action_phase_id ? "" : "・フェーズ未選択"}）`
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
          {tapHint && (
            <div style={{ fontSize: 10, color: "#0d9488", marginTop: 4 }}>🔗 {tapHint}</div>
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
      // 通常メッセージ carousel は新カードタイプ式プレビュー。
      return <CarouselCardsPreview cardType={item.carousel_card_type} cards={item.carousel_cards} />;
    case "flex":
      // Flex JSON を簡易プレビュー（保存値・送信ロジックには触れない・表示のみ）。
      // 未入力時は従来どおりアイコン表示。
      return item.flex_payload_json.trim()
        ? <FlexPreview json={item.flex_payload_json} />
        : (
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
          {item.message_type === "flex" ? (
            // Flex Message は LINE 同様「カードがそのまま会話欄に置かれる」見え方にする。
            // 通常メッセージ用の白い吹き出し（三角＋白背景）で囲まない（bubble/carousel とも）。
            <div style={{ maxWidth: "100%" }}>
              {renderBubbleContent(item, selectedRiddle, destinations)}
            </div>
          ) : (
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
          )}

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

function PreviewPanel({ chain, characters, riddles, destinations, oaTitle, workTitle }: PreviewPanelProps) {
  // ヘッダー (= LINE トーク画面の上部) は対象 OA（LINE公式アカウント）のタイトルを表示する。
  // 最初の発話キャラクター名には依存しない（発話者を変えてもタイトルは不変）。
  // フォールバック順: OAタイトル → 作品名 → "LINEプレビュー"。
  const headerTitle = oaTitle?.trim() || workTitle?.trim() || "LINEプレビュー";

  // chain 内のどこかに QR がある場合、それを chain 末尾の bubble に集約して表示する。
  // 探索順は後ろから前 = 実送信処理の moveQuickReplyToTail と同じ姿勢 (= tail が
  // 既に QR を持っていればそれを使い、無ければ後方から遡って見つけた最初のものを使う)。
  // 通常 QR ＋ 問題のヒント QR（incorrect_quick_replies）を実送信と同じ resolveDisplayQrItems で合成し、
  // chain 末尾側から最初に QR を持つ bubble のものを表示する（実機プレビュー一致）。
  let tailQR: QuickReplyItem[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const items = resolveDisplayQrItems({
      kind:                  chain[i].kind,
      hintMode:              chain[i].hint_mode,
      quickReplies:          chain[i].quick_replies,
      incorrectQuickReplies: chain[i].incorrect_quick_replies,
    });
    if (items.length > 0) {
      tailQR = items;
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
            {headerTitle}
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
// ImageTapActionEditor — 画像メッセージの「タップ時の動作」統一エディタ
//   1通目・2通目以降の両方で共通利用する。旧「画像タップ時の遷移先」は廃止し、これに一本化。
//   - なし / URLを開く（uri）/ メッセージを送信する（message・末尾メッセージのみ）
//   - 保存形式は image_action_type / image_action_text / image_action_url（既存カラム）。
// ────────────────────────────────────────────────────────
type ImageActionType = "" | "message" | "uri" | "liff" | "postback" | "message_with_phase";
function ImageTapActionEditor({
  actionType, text, url, phaseId, isTail, onChange, linkOptions, linkOptionsLiffConfigured, phases, idPrefix = "image_action",
}: {
  actionType: ImageActionType;
  text:       string;
  url:        string;
  /** type="message_with_phase" 用: 遷移先フェーズ ID。 */
  phaseId:    string;
  /** このメッセージが連続メッセージの末尾か（message / message_with_phase は末尾のみ許可）。 */
  isTail:     boolean;
  onChange:   (patch: Partial<{ actionType: ImageActionType; text: string; url: string; phaseId: string }>) => void;
  linkOptions: React.ComponentProps<typeof LinkPicker>["options"];
  linkOptionsLiffConfigured: boolean;
  /** message_with_phase の遷移先フェーズ選択肢。 */
  phases: { id: string; name: string }[];
  idPrefix?:  string;
}) {
  // 末尾以外なのに message / message_with_phase が入っている既存データ → 警告（保存は validation で弾く＝安全側）。
  const messageOnNonTail = (actionType === "message" || actionType === "message_with_phase") && !isTail;
  const isMessageLike = actionType === "message" || actionType === "message_with_phase";
  return (
    <div className="form-group" style={{ marginTop: 12 }}>
      <label style={fieldLabel} htmlFor={`${idPrefix}_type`}>
        タップ時の動作
        <span style={{ fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
      </label>
      <select
        id={`${idPrefix}_type`}
        className="form-input"
        value={actionType}
        onChange={(e) => onChange({ actionType: e.target.value as ImageActionType })}
        style={{ maxWidth: 320 }}
      >
        <option value="">なし（通常の画像メッセージとして送信）</option>
        <option value="uri">URL を開く</option>
        <option value="message" disabled={!isTail}>メッセージを送信する{!isTail ? "（末尾メッセージのみ）" : ""}</option>
        <option value="message_with_phase" disabled={!isTail}>メッセージを送信する＋フェーズ遷移{!isTail ? "（末尾メッセージのみ）" : ""}</option>
        <option value="liff" disabled>LIFF ページを開く（実装予定）</option>
        <option value="postback" disabled>内部イベントを発火する（実装予定）</option>
      </select>
      <div style={hintText}>
        アクションを設定すると、画像が LINE 上で Flex Message として送信され、タップ可能になります。
        {!isTail && <><br />メッセージ送信／メッセージ送信＋フェーズ遷移は、連続メッセージの最後の画像でのみ設定できます。</>}
      </div>

      {messageOnNonTail && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
          このメッセージは連続メッセージの末尾ではないため「メッセージを送信する／＋フェーズ遷移」は保存できません。「なし」または「URL を開く」に変更してください。
        </div>
      )}

      {actionType === "uri" && (
        <div className="form-group" style={{ marginTop: 12, marginLeft: 24, paddingLeft: 12, borderLeft: "3px solid #e5e7eb" }}>
          <label style={fieldLabel} htmlFor={`${idPrefix}_url`}>開く URL <RequiredMark /></label>
          <LinkPicker options={linkOptions} liffConfigured={linkOptionsLiffConfigured} onPick={(u) => onChange({ url: u })} />
          <input
            id={`${idPrefix}_url`}
            type="url"
            className="form-input"
            value={url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://example.com/"
            style={{ fontFamily: "monospace", fontSize: 13 }}
            maxLength={2000}
          />
          <div style={hintText}>https:// のみ対応。タップで外部ブラウザが開きます。</div>
        </div>
      )}

      {isMessageLike && isTail && (
        <div className="form-group" style={{ marginTop: 12, marginLeft: 24, paddingLeft: 12, borderLeft: "3px solid #e5e7eb" }}>
          <label style={fieldLabel} htmlFor={`${idPrefix}_text`}>送信されるテキスト <RequiredMark /></label>
          <input
            id={`${idPrefix}_text`}
            type="text"
            className="form-input"
            value={text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="例: 古い写真を見る"
            maxLength={300}
          />
          <div style={hintText}>
            プレイヤーが画像をタップすると、このテキストがプレイヤーから送信されたものとして扱われます。
            {actionType === "message_with_phase"
              ? <><br />このテキストを受信すると、設定したフェーズへ遷移します。<br /><strong>注意:</strong> 同じテキストを手入力した場合にも反応する可能性があります。</>
              : <><br />既存の応答キーワード／正解に設定すると、次のメッセージやフェーズ遷移につながります。</>}
          </div>
        </div>
      )}

      {actionType === "message_with_phase" && isTail && (
        <div className="form-group" style={{ marginTop: 12, marginLeft: 24, paddingLeft: 12, borderLeft: "3px solid #e5e7eb" }}>
          <label style={fieldLabel} htmlFor={`${idPrefix}_phase`}>遷移先フェーズ <RequiredMark /></label>
          <select
            id={`${idPrefix}_phase`}
            className="form-input"
            value={phaseId}
            onChange={(e) => onChange({ phaseId: e.target.value })}
            style={{ maxWidth: 320 }}
          >
            <option value="">（選択してください）</option>
            {phases.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <div style={hintText}>画像タップで上記テキストが送信され、その後このフェーズへ遷移します。</div>
        </div>
      )}

      {/* タップ時の挙動サマリ */}
      {(actionType === "uri" || (isMessageLike && isTail)) && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, fontSize: 12, color: "#0c4a6e", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>🎯 タップ時:</span>
          {actionType === "uri" && (
            <span>URL を開く <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, wordBreak: "break-all" }}>{url || "（未入力）"}</code></span>
          )}
          {actionType === "message" && (
            <span>メッセージ送信 <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4 }}>{text || "（未入力）"}</code></span>
          )}
          {actionType === "message_with_phase" && (
            <span>メッセージ送信＋フェーズ遷移 <code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4 }}>{text || "（未入力）"}</code>
              {" → "}<code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4 }}>{phases.find((p) => p.id === phaseId)?.name || "（フェーズ未選択）"}</code></span>
          )}
        </div>
      )}
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
  // 「設定あり」バッジは実際に効果がある演出のみで判定する（一覧バッジ hasAnyTiming と同義）。
  // 単純な truthy 判定は OFF（"immediate" / "false"）でも true になり誤表示するため timingFormHasEffect を使う。
  const hasValues = timingFormHasEffect(form);
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
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            margin: "0 0 -4px",
            padding: "10px 12px",
            borderRadius: 10,
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          ここでの待機時間・既読タイミング・「入力中…」表示は、<strong>返信（reply）時の短い演出</strong>です。
          1通目は reply で送られ通数を消費しません（連続メッセージの2通目以降は Push 配信になり、
          LINE公式アカウントの月間メッセージ通数を消費します）。
          <br />
          <strong>10分後・30分後など長時間あとに送る</strong>用途は reply では実現できません。
          下の「時間差メッセージ（予約送信）」をご利用ください（Push 配信・通数を消費します）。
        </div>
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
            <HelpDetails label="詳細（既読遅延の反映について）">
              既読遅延は現在、最初のメッセージにのみ実機反映されます。「入力中...」表示は反映されます。
            </HelpDetails>
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
            <HelpDetails label="詳細（「入力中...」表示の挙動）">
              「入力中...」表示は LINE 側の挙動（最小 5 秒・1 チャットに 1 つ）により、連続メッセージそれぞれの直前に必ず表示されるとは限りません（best-effort）。確実に「間」を作りたい場合は「前のメッセージからの待機時間」を設定してください。
            </HelpDetails>
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

          {/* 演出は「このメッセージ送信前」にのみ反映される旨の誤解防止文言（まとめ送信廃止方針・Phase 1）。
              常時の青ボックスは目立つため「詳細」トグル（薄いグレー）に格納する（文言は維持）。 */}
          <HelpDetails label="詳細（演出が反映されるタイミング）">
            待機時間・入力中表示は、<strong>このメッセージを送信する前</strong>に反映されます。次のメッセージにも演出を入れたい場合は、クイックリプライやキーワードなど、<strong>ユーザー操作を挟んで</strong>次のメッセージへ進めてください。
          </HelpDetails>
      </div>
    </SectionAccordion>
  );
}

// ────────────────────────────────────────────────────────
// ScheduledMessageInfo — 「時間差メッセージ（予約送信）」の概念説明（PR-1: 文言のみ・実送信なし）
//   reply 演出（短い待機・通数消費なし）と、長時間あとの push 配信（通数消費あり）を明確に分離する。
//   実際の予約作成・送信は後続 PR（ScheduledLineMessage テーブル + cron）で対応予定。
// ────────────────────────────────────────────────────────
function ScheduledMessageInfo() {
  return (
    <SectionAccordion
      title="時間差メッセージ（予約送信）"
      optional
      description="ユーザーの操作から指定時間後に push 配信でメッセージを送る機能（通数を消費します）"
      defaultOpen={false}
      badge={
        <span style={{ fontSize: 10, fontWeight: 700, background: "#ede9fe", color: "#6d28d9", borderRadius: 4, padding: "1px 6px" }}>
          準備中
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={checkNotice.muted}>
          <strong>時間差メッセージ（予約送信）とは</strong>
          <br />
          ユーザーの操作（タップや回答など）から <strong>10分後・30分後・1時間後・翌日</strong> など、
          指定した時間が経過したあとに、<strong>push 配信</strong>でメッセージを送る機能です。
          ARG・物語演出向けの「時間差」を作れます。
        </div>

        <div style={checkNotice.warn}>
          この機能は LINE公式アカウントの<strong>月間メッセージ通数を消費</strong>します（push 配信のため）。
          <br />
          無料枠や追加メッセージ上限を超えると、LINE 側で送信できない場合があります。
        </div>

        <div style={checkNotice.muted}>
          <strong>reply（返信）との違い</strong>
          <br />
          返信（reply）は受信から約1分以内・1回だけ使える仕組みのため、<strong>10分後など長時間あとの送信は reply では実現できません</strong>。
          上の「演出設定」（待機時間・既読・「入力中…」）は reply 用の短い演出です。長時間あとの送信はこの「時間差メッセージ」（push）で行います。
        </div>

        <div style={hintText}>
          ※ この機能は順次提供予定です。現在は設定項目（送信タイミング・送信内容・キャンセル条件など）の追加を準備しています。
        </div>
      </div>
    </SectionAccordion>
  );
}

/** UI feature flag: 設定 UI を出すのは NEXT_PUBLIC_ENABLE_SCHEDULED_MESSAGE_UI=true のときだけ。
 *  未設定なら従来通り「準備中」表示のまま（本番ユーザーが「保存したら送られる」と誤解しないため）。 */
const SCHEDULED_MESSAGE_UI_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SCHEDULED_MESSAGE_UI === "true";

const SCHED_DELAY_PRESETS: { label: string; minutes: number }[] = [
  { label: "10分後", minutes: 10 }, { label: "30分後", minutes: 30 },
  { label: "1時間後", minutes: 60 }, { label: "翌日(24h)", minutes: 1440 },
];

// ────────────────────────────────────────────────────────
// ScheduledMessageSettings — 「時間差メッセージ（予約送信）」の設定 UI（PR-4c-1）。
//   設定を保存するだけ。実際の予約作成・push 送信は runtime/webhook 未接続（次 PR）。
//   flag 無効時は ScheduledMessageInfo（準備中）を表示する。
// ────────────────────────────────────────────────────────
function ScheduledMessageSettings({ value, onChange, characters, oaId }: {
  /** 編集対象の予約送信フォーム状態（head の form.scheduled_message / slot の slot.scheduled_message）。 */
  value: ScheduledMessageFormState;
  onChange: (next: ScheduledMessageFormState) => void;
  characters: Character[];
  oaId: string;
}) {
  const s = value;
  const upd = (patch: Partial<ScheduledMessageFormState>) => onChange({ ...s, ...patch });
  const bodyMissing = s.enabled && !s.body.trim();
  const delayInvalid = s.enabled && (!Number.isFinite(s.delay_minutes) || s.delay_minutes < 1 || s.delay_minutes > 10080);

  return (
    <SectionAccordion
      title="時間差メッセージ（予約送信）"
      optional
      description="このメッセージが送信された後、指定時間後に別メッセージを push 配信する設定（通数を消費します）"
      defaultOpen={s.enabled}
      badge={s.enabled
        ? <span style={{ fontSize: 10, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px" }}>有効</span>
        : undefined}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={checkNotice.muted}>
          このメッセージが送信された後、指定時間後に<strong>別メッセージを push 配信</strong>します。
          <strong>このメッセージ自体の送信を遅らせる設定ではありません。</strong>
          短い「間」（数秒）は上の「演出設定」（待機時間・入力中…）をご利用ください。
        </div>
        <div style={checkNotice.warn}>
          予約された別メッセージは <strong>push 配信</strong>として送信され、<strong>LINE公式アカウントの月間メッセージ通数を消費</strong>します。
          reply では10分後送信はできません。無料枠や追加メッセージ上限を超えると、LINE 側で送信できない場合があります。
          {" "}
          <a href={`/oas/${oaId}/settings`} target="_blank" rel="noreferrer" style={{ color: "#92400e", textDecoration: "underline" }}>月間メッセージ使用状況を確認</a>
        </div>

        <div style={checkNotice.muted}>
          <strong>現在は設定の保存のみ</strong>です。実際の予約作成・送信は次のアップデートで接続します（保存しても、いまはまだ送信されません）。
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
          時間差メッセージを有効にする
        </label>

        {s.enabled && (
          <>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>送信タイミング（ユーザー操作の何分後に push するか）</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                {SCHED_DELAY_PRESETS.map((p) => (
                  <button
                    key={p.minutes} type="button"
                    onClick={() => upd({ delay_minutes: p.minutes })}
                    style={{
                      fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                      border: s.delay_minutes === p.minutes ? "1px solid #2563eb" : "1px solid #d1d5db",
                      background: s.delay_minutes === p.minutes ? "#eff6ff" : "#fff",
                      color: s.delay_minutes === p.minutes ? "#1d4ed8" : "#374151", fontWeight: 600,
                    }}
                  >{p.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>カスタム</span>
                <input
                  type="number" min={1} max={10080} className="form-input" style={{ fontSize: 13, width: 110 }}
                  value={s.delay_minutes}
                  onChange={(e) => upd({ delay_minutes: Math.max(1, Math.min(10080, Math.floor(Number(e.target.value) || 1))) })}
                />
                <span style={{ fontSize: 12, color: "#6b7280" }}>分後（1〜10080分 / 最大7日）</span>
              </div>
              {delayInvalid && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>送信タイミングは 1〜10080 分で指定してください。</div>}
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>送信内容（本文）<span style={{ color: "#dc2626" }}> *</span></label>
              <textarea
                className="form-input" rows={3} maxLength={5000} style={{ fontSize: 13, resize: "vertical", width: "100%" }}
                value={s.body}
                onChange={(e) => upd({ body: e.target.value })}
                placeholder="時間差で送るメッセージ本文"
              />
              {bodyMissing && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>有効にする場合は本文が必須です。</div>}
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>発話キャラクター（任意）</label>
              <select
                className="form-input" style={{ fontSize: 13 }}
                value={s.character_id}
                onChange={(e) => upd({ character_id: e.target.value })}
              >
                <option value="">（本文と同じ / デフォルト）</option>
                {characters.map((ch) => (<option key={ch.id} value={ch.id}>{ch.name}</option>))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>キャンセル条件</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "4px 0" }}>
                <input type="checkbox" checked={s.cancel_on_phase_change} onChange={(e) => upd({ cancel_on_phase_change: e.target.checked })} />
                ユーザーが別フェーズに進んでいたら送信をキャンセルする
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input type="checkbox" checked={s.cancel_on_work_completed} onChange={(e) => upd({ cancel_on_work_completed: e.target.checked })} />
                作品を終了済みのユーザーには送信をキャンセルする
              </label>
              <div style={hintText}>※ キャンセル判定は送信直前に行われます（次 PR で接続）。</div>
            </div>

            {/* 直列進行（PR-SER1: 保存のみ・runtime 未接続）。ON でこの予約が届くまで後続を止める。 */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>進行のしかた</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "4px 0" }}>
                <input type="checkbox" checked={s.hold_chain_until_sent} onChange={(e) => upd({ hold_chain_until_sent: e.target.checked })} />
                この予約送信が届くまで、次のメッセージを送らない
              </label>
              <div style={hintText}>
                ON にすると、このメッセージの予約送信が完了したあとに、次のメッセージへ進みます。
                物語を「1通目 → 10分後の返信 → 2通目」のように順番に進めたい場合に使います。
                <br />
                ※ 現在は<strong>検証中の機能</strong>です。後続停止の実行は staging でのみ有効です。本番では次の PR で「直列再開」まで対応後に有効化します。
              </div>
            </div>
          </>
        )}
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
  carousel_card_type:  CarouselCardType;
  carousel_cards:      CarouselCard[];
  character_id:        string;
  quick_replies:       QuickReplyItem[];
  /** 問題のヒント QR（プレビューで quick_replies と合成表示するため）。 */
  incorrect_quick_replies?: QuickReplyItem[];
  hint_mode?:          string;
  kind:                MessageKind;
  riddle_id:           string;
  puzzle_type:         string;
  answer:              string;
  tap_destination_id:  string;
  tap_url:             string;
  /** 画像タップ時アクション（プレビューの「タップ時:」表示用）。 */
  image_action_type?:  string;
  image_action_text?:  string;
  image_action_url?:   string;
  image_action_phase_id?: string;
  flex_payload_json:   string;
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
      carousel_card_type: "product",
      carousel_cards:     [],
      character_id:       "",
      quick_replies:      m.quick_replies ?? [],
      kind:               (m.kind as MessageKind) ?? "normal",
      riddle_id:          "",
      puzzle_type:        "",
      answer:             "",
      tap_destination_id: "",
      tap_url:            "",
      flex_payload_json:  "", // 上流 row は API 取得形に含めていないため空（編集中 message/slot のみプレビュー）
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
    carousel_card_type: form.carousel_card_type,
    carousel_cards:     form.carousel_cards,
    character_id:       form.character_id,
    quick_replies:      form.quick_replies,
    incorrect_quick_replies: form.incorrect_quick_replies,
    hint_mode:          form.hint_mode,
    kind:               form.kind,
    riddle_id:          form.riddle_id,
    puzzle_type:        form.puzzle_type,
    answer:             form.answers.find((a) => a.trim()) ?? form.answer,
    tap_destination_id: form.tap_destination_id,
    tap_url:            form.tap_url,
    image_action_type:  form.image_action_type,
    image_action_text:  form.image_action_text,
    image_action_url:   form.image_action_url,
    image_action_phase_id: form.image_action_phase_id,
    flex_payload_json:  form.flex_payload_json,
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
      carousel_card_type: s.carousel_card_type,
      carousel_cards:     s.carousel_cards,
      // 発話キャラクターの三分岐（AdditionalMessageBlock / additionalSlotToMsgBody と一致）:
      //   「指定しない」(sentinel) → キャラなし（デフォルト表示）/ 空文字 → 1通目を引き継ぐ / id → 指定。
      character_id:
        s.character_id === CHAIN_SPEAKER_NONE ? "" : (s.character_id || form.character_id),
      quick_replies:      dbRow?.quick_replies ?? [],
      // continuation は通常 kind=normal / puzzle 系フィールドは無い。
      kind:               "normal",
      riddle_id:          "",
      puzzle_type:        "",
      answer:             "",
      tap_destination_id: "",
      tap_url:            "",
      image_action_type:  s.image_action_type,
      image_action_text:  s.image_action_text,
      image_action_url:   s.image_action_url,
      image_action_phase_id: s.image_action_phase_id,
      flex_payload_json:  s.flex_payload_json,
    });
    if (s.free_input_enabled) return out;
    if (out.length >= PREVIEW_CHAIN_MAX) return out;
  }

  return out;
}

// ────────────────────────────────────────────────────────

function AdditionalMessageBlock({
  index, slot, onChange, onRemove, onDetach, canDetach, onMoveUp, onMoveDown, canMoveUp, canMoveDown, oaId, workId, characters, allMessages,
  isTail, linkOptions, linkOptionsLiffConfigured, phases,
}: {
  index:      number;
  slot:       AdditionalMessageSlot;
  onChange:   (slot: AdditionalMessageSlot) => void;
  onRemove:   () => void;
  /** このスロットが連続メッセージの末尾か（画像 message アクションは末尾のみ許可）。 */
  isTail:     boolean;
  linkOptions: React.ComponentProps<typeof LinkPicker>["options"];
  linkOptionsLiffConfigured: boolean;
  /** 画像 message_with_phase の遷移先フェーズ選択肢。 */
  phases: { id: string; name: string }[];
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
            <option value={CHAIN_SPEAKER_NONE}>— キャラクターを指定しない —</option>
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
                onClick={() => onChange({ ...slot, message_type: opt.value, body: "", asset_url: "", carousel_items: [], carousel_cards: opt.value === "carousel" ? [emptyCarouselCard(slot.carousel_card_type)] : [] })}
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
          <>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel}>画像</label>
              <ImageUploader
                value={slot.asset_url}
                onChange={(url) => onChange({ ...slot, asset_url: url })}
                oaId={oaId}
                workId={workId}
              />
            </div>
            {/* タップ時の動作（1通目と同じ統一UI）。message アクションは末尾のみ。 */}
            <ImageTapActionEditor
              actionType={slot.image_action_type}
              text={slot.image_action_text}
              url={slot.image_action_url}
              phaseId={slot.image_action_phase_id}
              isTail={isTail}
              onChange={(patch) => onChange({
                ...slot,
                ...(patch.actionType !== undefined ? { image_action_type: patch.actionType } : {}),
                ...(patch.text !== undefined ? { image_action_text: patch.text } : {}),
                ...(patch.url !== undefined ? { image_action_url: patch.url } : {}),
                ...(patch.phaseId !== undefined ? { image_action_phase_id: patch.phaseId } : {}),
              })}
              linkOptions={linkOptions}
              linkOptionsLiffConfigured={linkOptionsLiffConfigured}
              phases={phases}
              idPrefix={`slot_${index}_image_action`}
            />
          </>
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
          <CarouselCardsEditor
            cardType={slot.carousel_card_type}
            cards={slot.carousel_cards}
            onChange={(cardType, cards) => onChange({ ...slot, carousel_card_type: cardType, carousel_cards: cards })}
          />
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
              代替テキスト <RequiredMark />
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
              Flex Message JSON <RequiredMark />
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

        {/* 前のメッセージからの待機時間（2通目以降の lag_ms）。
            短い「間」(演出)用に最大 SLOT_LAG_MS_MAX(8秒) まで。長時間待機は webhook を保持し 504 を招くため、
            下の「時間差メッセージ（予約送信）」へ誘導する。既存の超過値は自動クリアせず読み取り専用で残す。 */}
        <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
          <label style={fieldLabel}>前のメッセージからの短い待機演出</label>
          {(slot.lag_ms ?? 0) > SLOT_LAG_MS_MAX ? (
            // 既存の長時間待機（>8秒）: 非破壊で保持し、読み取り専用＋短縮導線のみ提示。
            <div style={{ ...checkNotice.warn, fontSize: 12 }}>
              旧設定の待機時間 <strong>{Math.round((slot.lag_ms ?? 0) / 1000)}秒</strong> が残っています（自動削除はしません）。
              長時間の待機は webhook を長く保持し配信失敗（504）の原因になります。
              <strong>長時間あとの送信は下の「時間差メッセージ（予約送信）」へ移行</strong>してください。
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "2px 10px" }}
                  onClick={() => onChange({ ...slot, lag_ms: SLOT_LAG_MS_MAX })}>
                  待機時間を8秒に短縮する
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 秒のみ（0〜8秒）。分入力は出さない＝合計が8秒を超える値を新規設定できない。
                  reply は1回の API で複数通をまとめて返すため、2通目だけを長時間あとに送ることはできない。
                  長時間あとの送信は push 配信の「時間差メッセージ（予約送信）」を使う。 */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number" min={0} max={SLOT_LAG_SECONDS_MAX} step={1}
                  className="form-input" style={{ width: 80, fontSize: 13 }}
                  value={Math.min(SLOT_LAG_SECONDS_MAX, Math.floor((slot.lag_ms ?? 0) / 1000))}
                  onChange={(e) => onChange({ ...slot, lag_ms: clampNewSlotLagMs(Math.floor(Number(e.target.value) || 0) * 1000) })}
                />
                <span style={{ fontSize: 12, color: "#6b7280" }}>秒（0〜8秒）</span>
              </div>
              <div style={hintText}>
                前の吹き出しを送ったあと、このメッセージを送る前に待つ<strong>短い演出</strong>です（<strong>最大8秒</strong>・分指定はできません）。
                <br />
                ※ これは <strong>LINE reply API のメッセージ間隔指定ではありません</strong>。長時間の待機には使わず、8秒以内の短い演出に限ってご利用ください。
                <br />
                10分後など長時間あとに送る場合は、下の<strong>「時間差メッセージ（予約送信）」</strong>をご利用ください。
              </div>
            </>
          )}
        </div>

        {/* 演出設定 (既読 / typing / loading) — 折りたたみ。
            1 通目 form と同じ TimingConfigSection を generic 化して再利用。 */}
        <TimingConfigSection
          form={slot}
          set={(k, v) => onChange({ ...slot, [k]: v })}
          isAdditional
        />

        {/* 時間差メッセージ（予約送信）。1通目と同じコンポーネント。slot にも「N分後フォローアップ」を付けられる。
            flag 有効時のみ表示（NEXT_PUBLIC_ENABLE_SCHEDULED_MESSAGE_UI）。未設定なら何も出さない（slot は準備中表示を出さない）。 */}
        {SCHEDULED_MESSAGE_UI_ENABLED && (
          <div style={{ marginTop: 12 }}>
            <ScheduledMessageSettings
              value={slot.scheduled_message}
              onChange={(v) => onChange({ ...slot, scheduled_message: v })}
              characters={characters}
              oaId={oaId}
            />
          </div>
        )}

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
        {/* 送信後の自動フェーズ移動は「メッセージ群全体で1つ」の設定のため、各スロットには表示しない
            （途中送信での発火を防ぐ）。設定は下部「メッセージ後の遷移（送信直後）」で行い、保存時に
            チェーン末尾へ正規化する（buildChainSaveBody）。 */}
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
  oaId, workId, workTitle, oaTitle, initialForm, isNew,
  submitting, deleting, onSubmit, onDelete, messageId, backHref,
}: MessageFormProps) {
  // キャンセル/パンくず「メッセージ」の戻り先（元タブ保持）。未指定時は一覧トップ。
  const messagesBackHref = backHref ?? `/oas/${oaId}/works/${workId}/messages`;
  const [form, setForm]       = useState<MessageFormState>(initialForm);
  const [error, setError]     = useState<string | null>(null);
  const bodyTextareaRef       = useRef<HTMLTextAreaElement>(null);

  const isPuzzle = form.kind === "puzzle";
  const isSystemNotice = form.kind === "system_notice";

  // プラン制限: ロケーション関連機能（送信後に地点到着を待つ）は location feature 許可プラン
  // （Pro Max / 委託）でのみ表示する。ロケーション管理画面（/locations）と同じ判定基準。
  // 取得中はデフォルト basic（= 非許可）になるため安全側で非表示。判定不能も非表示。
  const { effectivePlan } = useAccessPreview(oaId);
  const canUseLocationFeatures = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.location }).allowed;

  const [phases, setPhases]         = useState<PhaseWithCounts[]>([]);
  const [locations, setLocations]   = useState<LocationWithTransition[]>([]);
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
    // 設定ミス防止: 成功時メッセージにも待機トリガーがあるか（チェーン継続判定）
    checkin_trigger_type?: string | null;
    // フェーズ入場プレビューを実送信に合わせるための QR 有無フラグ。
    has_quick_reply?: boolean;
  }[]>([]);

  // 設定ミス防止チェック用: この work のビーコントリガー（地点紐づけ確認）。
  const [beaconTriggers, setBeaconTriggers] = useState<{ id: string; name: string; hwid: string; enabled: boolean; location_id: string | null }[]>([]);

  // ── 既存メッセージ取り込み（PR3b-2）──
  const [importPicker, setImportPicker] = useState<{ insertIndex: number; appendAtEnd: boolean } | null>(null);

  // 「新規作成は1通のみ」制限は撤回。新規・編集とも 1チェーン最大5通まで連続メッセージを作成できる
  // （head + 連続最大4通）。Quick Reply / キーワード / QR / GPS を挟まなくても連続送信できる。
  // 6通目以降は作れないよう、追加系ボタンは canAddMessage で 5通上限を判定する。
  const MAX_CHAIN_MESSAGES = 5;
  const canAddMessage = (1 + form.additionalMessages.length) < MAX_CHAIN_MESSAGES;

  // ── destination 選択用 ──
  const [destinations, setDestinations] = useState<LineDestination[]>([]);

  // ── URL候補（LIFF / ロケーションURL）。既存 API だけで生成し、各URL入力欄の補助に使う。 ──
  const { options: linkOptions, liffConfigured: linkOptionsLiffConfigured } = useWorkLinkOptions(oaId, workId);

  useEffect(() => {
    const token = getDevToken();
    // destination 一覧も並行取得
    destinationApi.list(token, workId).then(setDestinations).catch(() => {});
  }, [workId]);

  // 旧「画像タップ時の遷移先」の保存済み遷移先 (tap_destination_id) を、新「タップ時の動作: URLを開く」へ
  // 一度だけ移行する（destinations 解決後に id→url を解決）。tap_url(直接URL)は msgToFormState で移行済み。
  // http/https に解決できる遷移先のみ移行し、それ以外は安全側で据え置く（保存時に統一形式へ寄せる）。
  const tapDestMigratedRef = useRef(false);
  useEffect(() => {
    if (tapDestMigratedRef.current) return;
    if (form.message_type !== "image" || form.image_action_type || !form.tap_destination_id) return;
    if (destinations.length === 0) return;
    const url = (destinations.find((d) => d.id === form.tap_destination_id)?.url_or_path ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    tapDestMigratedRef.current = true;
    setForm((prev) => ({ ...prev, image_action_type: "uri", image_action_url: url, tap_destination_id: "" }));
  }, [destinations, form.message_type, form.image_action_type, form.tap_destination_id]);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      phaseApi.list(token, workId),
      characterApi.list(token, workId),
      riddleApi.list(token, oaId),
      messageApi.list(token, workId),
      locationApi.list(token, workId, { is_active: true }).catch(() => [] as LocationWithTransition[]),
    ]).then(([ph, ch, rd, msgs, locs]) => {
      setPhases(ph);
      setCharacters(ch);
      setRiddles(rd);
      setLocations(locs);
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
        checkin_trigger_type:       m.checkin_trigger_type ?? null,
        has_quick_reply:            (m.quick_replies?.length ?? 0) > 0,
      })));
    }).catch(() => {});
  }, [workId, oaId]);

  // 設定ミス防止チェック用: ビーコントリガー一覧（地点紐づけ確認）。失敗時は空配列で degrade。
  useEffect(() => {
    if (!canUseLocationFeatures) return; // ロケーション機能が無いプランでは不要
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/works/${encodeURIComponent(workId)}/beacons`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (cancelled || !json?.success || !Array.isArray(json.data)) return;
        setBeaconTriggers(json.data.map((b: { id: string; name: string; hwid: string; enabled: boolean; location_id: string | null }) => ({
          id: b.id, name: b.name, hwid: b.hwid, enabled: b.enabled, location_id: b.location_id ?? null,
        })));
      } catch { /* 取得失敗時はビーコン関連の補足を出さない */ }
    })();
    return () => { cancelled = true; };
  }, [workId, canUseLocationFeatures]);

  function set<K extends keyof MessageFormState>(k: K, v: MessageFormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // プレビュー用 chain (= 上流の親 + 編集中 form + form.additionalMessages を head→tail で並べたもの)。
  // 構築は純関数 buildPreviewChain に切り出し済。空配列なら PreviewPanel は head 1 通のみ描画する。
  const previewChain = buildPreviewChain({ messageId, form, allMessages });

  // ── 設定ミス防止チェック（地点到着トリガー）。警告は保存をブロックしない（補足表示のみ）。──
  const ctType         = form.checkin_trigger_type;
  const ctLocationId   = form.checkin_trigger_location_id;
  const ctNextMsgId    = form.checkin_trigger_next_message_id;
  const ctNextPhaseId  = form.checkin_trigger_next_phase_id;
  /** 選択地点に紐づく BeaconTrigger（Beacon 検知で実際に使われるもの）。 */
  const beaconsForCtLocation = ctLocationId ? beaconTriggers.filter((b) => b.location_id === ctLocationId) : [];
  /** locationId 未設定の Beacon（地点到着トリガーには使われない）。 */
  const hasUnlinkedBeacons   = beaconTriggers.some((b) => !b.location_id);
  /** 成功時メッセージ自身に待機トリガーがあるか（チェーン継続判定）。 */
  const ctNextMessage        = ctNextMsgId ? allMessages.find((m) => m.id === ctNextMsgId) : null;
  const ctNextMessageHasChain = !!ctNextMessage?.checkin_trigger_type;
  /** 次フェーズが現在の自フェーズと同一（不自然な可能性）。 */
  const ctNextPhaseIsSame    = !!ctNextPhaseId && ctNextPhaseId === form.phase_id;

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
    const err = validateMessageForm(form, phases.map((p) => ({ id: p.id })));
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
          border: 1px solid var(--color-line, #e8edea);
          border-radius: 16px;
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
            { label: "メッセージ", href: messagesBackHref },
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
                // 通常メッセージ側と同じ select + hintText 構造に揃える。
                // 謎・問題は kind="puzzle" が種別スロットを占有し、問題メッセージ自体の送信は「フェーズ遷移時」の
                // 1 種類のみ。よって表示専用の 1 項目 select（form.kind 等の保存値には紐づけない）。
                // 「指定フェーズ内の回答に反応」は送信タイミングの選択肢ではなく、下の補足文で説明する。
                <>
                  <select
                    className="form-input"
                    value="puzzle_normal"
                    onChange={() => { /* 表示専用（謎・問題は種別固定・保存値は不変） */ }}
                    aria-label="送信タイミング"
                  >
                    <option value="puzzle_normal">通常（フェーズ遷移時に送信）</option>
                  </select>
                  <div style={hintText}>
                    この問題メッセージ自体の送信タイミングを選びます。送信後は、指定したフェーズにいるユーザーの回答に反応します。正解後に次へ進めたい場合だけ、フェーズ遷移を設定してください。
                  </div>
                </>
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
                    <option value="global">共通メッセージ（フェーズ不問・常時反応）</option>
                    <option value="system_notice">システム通知（中央表示・例: ミカさんが入室しました）</option>
                    {/* 「ヒント（将来拡張）」は選択肢から撤去（ヒントはヒントクイックリプライで実装済み）。
                        既存データに kind="hint" が保存されている場合のみ表示専用で復元し、保存値を壊さない。 */}
                    {form.kind === "hint" && <option value="hint">ヒント（将来拡張）</option>}
                  </select>
                  <div style={hintText}>
                    {form.kind === "start"    && "開始フェーズの startTrigger が一致したとき送信されます。応答キーワードの入力が必要です。フェーズに kind=start のメッセージがない場合は通常メッセージにフォールバックします。"}
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
                      <br />
                      ⚠️ 共通にすると、どのフェーズでもこのキーワードに反応します。物語進行に依存する選択肢（特定の場面だけ出すボタン等）では通常おすすめしません。その場合は種別を「応答」にして有効フェーズを指定してください。
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
                {(form.kind === "response" || form.kind === "global" || form.kind === "start") && (
                  <span style={{ fontSize: 10, fontWeight: 700, background: "#fef2f2", color: "#dc2626", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>必須</span>
                )}
              </label>
              <KeywordListEditor
                value={form.trigger_keyword}
                onChange={(v) => set("trigger_keyword", v)}
                phases={phases}
                currentMessageId={messageId}
                allMessagesForLink={allMessages}
              />
              <div style={{ ...hintText, marginTop: 6 }}>
                {form.kind === "start"  && "開始演出の場合、このキーワードで演出を開始します。"}
                {form.kind === "global" && "どのフェーズでも反応します。キーワードは必須です。"}
                {form.kind !== "start" && form.kind !== "global" && "複数設定可。いずれかに一致したとき返信します。この応答キーワードは、下で指定した「フェーズ」にいるときだけ反応します（どのフェーズでも反応させたい場合は種別を「共通」に）。"}
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

            {/* ── 発話キャラクター（謎・問題の本文。通常メッセージと同じ仕様。未設定はデフォルト発話者） ── */}
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

            {/* ── テキスト ── */}
            {mtype === "text" && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={fieldLabel} htmlFor="puzzle_body">
                  本文 <RequiredMark />
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
                    画像 <RequiredMark />
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
                    動画 URL <RequiredMark />
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
                    カード <RequiredMark />
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
                    onClick={() => {
                      set("message_type", opt.value);
                      // カルーセル選択時、カード未作成なら初期カードを1枚入れて各タイプのフォームを表示する。
                      if (opt.value === "carousel" && form.carousel_cards.length === 0) {
                        set("carousel_cards", [emptyCarouselCard(form.carousel_card_type)]);
                      }
                    }}
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
                  代替テキスト <RequiredMark />
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
                  Flex Message JSON <RequiredMark />
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
                <div style={{ ...hintText, marginTop: 4 }}>
                  💡 ボタンの <code>action.type=&quot;message&quot;</code> は、押すと <code>action.text</code> がプレイヤーの発話として届きます。
                  反応させるには、<strong>同じフェーズ</strong>に同じテキストの「応答キーワード」（種別=応答）を作成してください。
                  共通の場合のみ、どのフェーズでも反応します。
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

                {/* D. Flex Message 用 URLコピー補助（JSON は自動変更しない） */}
                <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#f9fafb" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Flex Message用URLコピー</div>
                  <LinkCopyList options={linkOptions} liffConfigured={linkOptionsLiffConfigured} />
                </div>
              </div>
            )}

            {/* ── テキスト ── */}
            {mtype === "text" && (
              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={fieldLabel} htmlFor="body">
                  {isSystemNotice ? "表示テキスト" : "本文"} <RequiredMark />
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
                    画像 <RequiredMark />
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
                {/* 旧「画像タップ時の遷移先」(TapDestinationSection / tap_destination_id・tap_url) は廃止。
                    タップ設定は下の「タップ時の動作」(image_action) に一本化。既存の tap_* 値は
                    読込時に「URLを開く」へ移行し、保存時に統一形式へ寄せる（msgToFormState / formStateToMsgBody）。 */}

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

                {/* タップ時の動作（統一UI）。1通目が末尾になるのは連続メッセージが無いときのみ。 */}
                <ImageTapActionEditor
                  actionType={form.image_action_type}
                  text={form.image_action_text}
                  url={form.image_action_url}
                  phaseId={form.image_action_phase_id}
                  isTail={form.additionalMessages.length === 0}
                  onChange={(patch) => {
                    if (patch.actionType !== undefined) set("image_action_type", patch.actionType);
                    if (patch.text !== undefined) set("image_action_text", patch.text);
                    if (patch.url !== undefined) set("image_action_url", patch.url);
                    if (patch.phaseId !== undefined) set("image_action_phase_id", patch.phaseId);
                  }}
                  linkOptions={linkOptions}
                  linkOptionsLiffConfigured={linkOptionsLiffConfigured}
                  phases={phases.map((p) => ({ id: p.id, name: p.name }))}
                  idPrefix="image_action"
                />
              </>
            )}

            {/* ── 謎 ── */}
            {mtype === "riddle" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="riddle_id">
                    謎 <RequiredMark />
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
                {/* 動画メディア設定（メディアソース/URL/サムネ/用途/サイズ確認/検証） */}
                <VideoMediaSection form={form} set={set} oaId={oaId} workId={workId} />
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
                <CarouselCardsEditor
                  cardType={form.carousel_card_type}
                  cards={form.carousel_cards}
                  onChange={(cardType, cards) => { set("carousel_card_type", cardType); set("carousel_cards", cards); }}
                />
                <div className="form-group" style={{ marginBottom: 0, marginTop: 12 }}>
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
                  <div style={{ ...hintText, marginTop: 4 }}>通知や未対応端末で表示される代替テキストです。</div>
                </div>
              </>
            )}

            {/* ── ボイス ── */}
            {mtype === "voice" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="asset_url_voice">
                    音声ファイル URL <RequiredMark />
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
                  {/* 直接アップロード（成功時に上の URL 欄へ反映）。手入力も引き続き可能。 */}
                  <MediaUploadButton
                    mediaType="audio"
                    oaId={oaId}
                    workId={workId}
                    onUploaded={(url) => set("asset_url", url)}
                  />
                  <div style={hintText}>
                    LINE が対応する音声形式: M4A (AAC)・最大60秒
                  </div>
                  {/* 再生確認用プレーヤー（http(s) URL のときのみ）。読み込み失敗してもクラッシュしない。 */}
                  {/^https?:\/\//i.test(form.asset_url.trim()) && (
                    <div style={{ marginTop: 10 }}>
                      <div style={hintText}>プレビュー（再生確認）</div>
                      <audio
                        key={form.asset_url}
                        src={form.asset_url.trim()}
                        controls
                        preload="metadata"
                        style={{ width: "100%", maxWidth: 320, marginTop: 4 }}
                      >
                        お使いのブラウザは音声の再生に対応していません。
                      </audio>
                    </div>
                  )}
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

                {/* 時間差メッセージ（予約送信）。flag 有効時は設定 UI（保存のみ・runtime 未接続）、
                    未設定なら従来通り「準備中」表示（PR-4c-1）。 */}
                <div style={{ marginTop: 12 }}>
                  {SCHEDULED_MESSAGE_UI_ENABLED
                    ? <ScheduledMessageSettings value={form.scheduled_message} onChange={(v) => set("scheduled_message", v)} characters={characters} oaId={oaId} />
                    : <ScheduledMessageInfo />}
                </div>

              </div>{/* /padding */}
            </div>{/* /1通目ラッパー */}

            {/* === 2通目以降 === */}
            {/* freeInput 境界: head か途中スロットが freeInput なら、それ以降は「自由入力後の応答」。
                runtime（buildMessageChain/buildPhaseMessages）は freeInput で即時送信を停止するため、
                以降のスロットは通常の連続送信では届かない。編集UI上でも区切って明示する。 */}
            {(() => {
              // 新規作成でも 2通目以降のスロットをレンダーする（1チェーン最大5通の連続メッセージを許可）。
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
                      isTail={idx === form.additionalMessages.length - 1 || slot.free_input_enabled}
                      linkOptions={linkOptions}
                      linkOptionsLiffConfigured={linkOptionsLiffConfigured}
                      phases={phases.map((p) => ({ id: p.id, name: p.name }))}
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
                    {canAddMessage && !headFree && canInsertAt(form.additionalMessages, idx + 1) && (
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

            {/* 連続メッセージの追加（新規・編集とも 1チェーン最大5通）。自由入力プロンプト時は追加不可、
                5通到達時は控えめに上限を表示（目立つ説明ボックスは出さない）。 */}
            {form.free_input_enabled ? (
              <div style={{ marginTop: 14, padding: "8px 12px", background: "#faf5ff", border: "1px dashed #d8b4fe", borderRadius: 8, fontSize: 11, color: "#7c3aed", lineHeight: 1.6 }}>
                1通目が自由入力プロンプトのため、連続メッセージは追加できません（自由入力後の応答は別枠で管理します）。
              </div>
            ) : canAddMessage ? (
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
            ) : (
              <div style={{ marginTop: 14, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
                連続メッセージは最大5通までです。
              </div>
            )}

            {/* 既存メッセージ取り込み（#6-4d・PR3b-2）。head が確定している編集時のみ・5通上限内。 */}
            {canAddMessage && !form.free_input_enabled && !isNew && messageId && (
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

            {/* 応答5通以上の警告（保存はブロックしない・体験への注意喚起）。head + 連続メッセージの合計で判定。 */}
            {(1 + form.additionalMessages.length) >= 5 && (
              <div style={{
                marginTop: 12, padding: "10px 12px", background: "#fffbeb",
                border: "1px solid #fde68a", borderRadius: 8, color: "#92400e",
                fontSize: 12, lineHeight: 1.7,
              }}>
                ⚠️ この応答は5通以上のメッセージを送信します。プレイヤー体験が重くなる可能性があるため、必要に応じて分割や削減を検討してください。
              </div>
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
              // 「📤 実機での送信プレビュー / このメッセージで送信: X通 / (text) 一覧」は通常編集では
              // 説明過多なため撤去。自由入力フロー情報・実害のある 5通超警告・QR末尾の注意だけを残し、
              // 表示すべき情報が無いときはボックスごと出さない。
              const hasSendInfo =
                pv.freeInputAt !== null ||
                pv.responseMessages.length > 0 ||
                pv.overLimit ||
                form.quick_replies.length > 0;
              if (!hasSendInfo) return null;
              return (
                <div style={{ marginTop: 16, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, lineHeight: 1.7 }}>
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
                  {form.quick_replies.length > 0 && (
                    <div style={{ marginTop: 8, color: "#0369a1", fontSize: 11 }}>
                      ℹ️ クイックリプライは編集上は先頭メッセージに設定しますが、実機ではこの連続メッセージの<strong>末尾</strong>に表示されます。
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
            currentPhaseId={form.phase_id || null}
            transitionMessages={allMessages.filter((m) => m.id !== messageId)}
            characters={characters}
            workId={workId}
            oaId={oaId}
            destinations={destinations}
            allMessages={allMessages}
            linkOptions={linkOptions}
            linkOptionsLiffConfigured={linkOptionsLiffConfigured}
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
                {/* checkbox → トグルスイッチ（見た目のみ変更・状態/保存仕様は不変）。
                    スイッチ＝ON/OFF 操作、ラベルクリックでも切替（どちらも set で同じ boolean を更新）。 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Switch
                    checked={form.free_input_enabled}
                    onChange={(v) => set("free_input_enabled", v)}
                    ariaLabel="このメッセージ送信後に自由入力を受け付ける"
                  />
                  <span
                    style={{ fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                    onClick={() => set("free_input_enabled", !form.free_input_enabled)}
                  >
                    このメッセージ送信後に自由入力を受け付ける
                  </span>
                </div>
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
              送信後の待機トリガー（地点到着で自動進行）
              このメッセージ送信後、指定地点に到着して QR/GPS チェックインしたら
              次のメッセージを自動送信し、必要ならフェーズを進める。
              まだこのメッセージに到達していない人には送信されない（誤送信防止）。
              プラン制限: location feature 許可プラン（Pro Max / 委託）でのみ表示。
          ════════════════════════════════════════ */}
          {canUseLocationFeatures && !isPuzzle && form.kind !== "system_notice" && (
            <SectionAccordion
              title="送信後に地点到着を待つ（自動進行）"
              optional
              description="このメッセージを送ったあと、指定した地点に到着してチェックインしたら、次のメッセージを自動で送ります。"
              defaultOpen={!!form.checkin_trigger_type}
            >
              <div style={{
                fontSize: 12, lineHeight: 1.6, padding: "10px 12px", marginBottom: 12,
                background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, color: "#075985",
              }}>
                例:「次は◯◯へ向かってください」を送ったあと、その場所のQRを読む（または現在地でチェックインする）と、続きのメッセージが自動で届きます。
                <br />
                <strong>このメッセージにまだ到達していない人には届きません。</strong>同じ到着での二重送信も自動で防ぎます。
              </div>

              <div className="form-group">
                <label style={fieldLabel} htmlFor="checkin_trigger_type">到着の検知方法</label>
                <select
                  id="checkin_trigger_type"
                  className="form-input"
                  style={{ maxWidth: 360 }}
                  value={form.checkin_trigger_type}
                  onChange={(e) => set("checkin_trigger_type", e.target.value)}
                >
                  <option value="">使わない</option>
                  <option value="qr">QRコードの読み取り</option>
                  <option value="gps">現在地（GPS）でチェックイン</option>
                  <option value="beacon">Beacon検知を待つ</option>
                </select>
                <div style={{ ...hintText, marginTop: 4 }}>
                  「現在地（GPS）」は、プレイヤーがLIFF画面を開いてチェックインする方式です（バックグラウンドの自動検知ではありません）。
                </div>
                {form.checkin_trigger_type === "beacon" && (
                  <div style={{ ...hintText, marginTop: 4, color: "#b45309" }}>
                    Beacon検知を使うには、対象地点に紐づくビーコンが必要です。ビーコン設定画面で「紐づけ地点」に同じ地点を選んでおいてください（未到達のユーザーには送信されません）。
                  </div>
                )}
              </div>

              {form.checkin_trigger_type && (
                <>
                  {/* 対象地点（必須） */}
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label style={fieldLabel} htmlFor="checkin_trigger_location_id">
                      到着を待つ地点 <RequiredMark />
                    </label>
                    <select
                      id="checkin_trigger_location_id"
                      className="form-input"
                      style={{ maxWidth: 360 }}
                      value={form.checkin_trigger_location_id}
                      onChange={(e) => set("checkin_trigger_location_id", e.target.value)}
                    >
                      <option value="">— 地点を選択 —</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                    {locations.length === 0 && (
                      <div style={{ ...hintText, marginTop: 4, color: "#b45309" }}>
                        この作品にはまだ地点が登録されていません。先に「地点（ロケーション）」を作成してください。
                      </div>
                    )}
                  </div>

                  {/* 到着時に送るメッセージ（任意） */}
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label style={fieldLabel} htmlFor="checkin_trigger_next_message_id">
                      到着したら送るメッセージ
                      <span style={{ fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
                    </label>
                    <select
                      id="checkin_trigger_next_message_id"
                      className="form-input"
                      style={{ maxWidth: 360 }}
                      value={form.checkin_trigger_next_message_id}
                      onChange={(e) => set("checkin_trigger_next_message_id", e.target.value)}
                    >
                      <option value="">— 送信しない（フェーズ移動のみ等）—</option>
                      {allMessages
                        .filter((m) => m.id !== messageId)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {(m.body || "(本文なし)").slice(0, 30)}
                          </option>
                        ))}
                    </select>
                    <div style={{ ...hintText, marginTop: 4 }}>
                      到着時に送信されるメッセージにも待機トリガーを設定すると、次の地点への移動を続けて案内できます。
                    </div>
                  </div>

                  {/* 到着時に進めるフェーズ（任意） */}
                  <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
                    <label style={fieldLabel} htmlFor="checkin_trigger_next_phase_id">
                      到着したら進めるフェーズ
                      <span style={{ fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: "#64748b", borderRadius: 4, padding: "1px 6px", marginLeft: 6 }}>任意</span>
                    </label>
                    <select
                      id="checkin_trigger_next_phase_id"
                      className="form-input"
                      style={{ maxWidth: 360 }}
                      value={form.checkin_trigger_next_phase_id}
                      onChange={(e) => set("checkin_trigger_next_phase_id", e.target.value)}
                    >
                      <option value="">— フェーズを移動しない —</option>
                      {phases.map((ph) => (
                        <option key={ph.id} value={ph.id}>{ph.name}</option>
                      ))}
                    </select>
                    <div style={{ ...hintText, marginTop: 4 }}>
                      フェーズを移動すると、その地点チェックインが「次の段階に進む条件」になります。
                    </div>
                  </div>

                  {/* ── 設定ミス防止チェック（警告・補足。保存はブロックしない）── */}
                  <div className="form-group" style={{ marginTop: 14, marginBottom: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    {/* 対象地点 未選択 */}
                    {!ctLocationId && (
                      <div style={checkNotice.warn}>⚠ 対象地点が未設定です。到着判定に使う地点を選択してください。</div>
                    )}
                    {/* 成功時メッセージ 未選択 */}
                    {!ctNextMsgId && (
                      <div style={checkNotice.warn}>⚠ 成功時メッセージが未設定です。到着後に送信するメッセージを選択してください。</div>
                    )}
                    {/* チェーン継続 / 終了 */}
                    {ctNextMsgId && (
                      ctNextMessageHasChain
                        ? <div style={checkNotice.info}>✓ この成功時メッセージにも待機トリガーが設定されています。続けて次の地点待ちにつながります。</div>
                        : <div style={checkNotice.muted}>このメッセージで地点到着チェーンは終了します。続けて次の地点へ進めたい場合は、成功時メッセージ側にも待機トリガーを設定してください。</div>
                    )}
                    {/* Beacon: 地点紐づけ確認 */}
                    {ctType === "beacon" && ctLocationId && (
                      beaconsForCtLocation.length === 0
                        ? <div style={checkNotice.warn}>⚠ この地点に紐づくBeaconがありません。Beacon検知で進行させるには、ビーコン編集画面で同じ地点を紐づけてください。</div>
                        : (
                          <div style={checkNotice.info}>
                            ✓ この地点には {beaconsForCtLocation.length} 件のBeaconが紐づいています。
                            <div style={{ marginTop: 2, fontWeight: 400 }}>
                              {beaconsForCtLocation.map((b) => `${b.name}（${b.hwid}${b.enabled ? "" : "・無効"}）`).join(" / ")}
                            </div>
                          </div>
                        )
                    )}
                    {/* Beacon: 未紐づけ Beacon の補足 */}
                    {ctType === "beacon" && hasUnlinkedBeacons && (
                      <div style={checkNotice.muted}>地点に紐づいていないBeaconは、地点到着トリガーには使用されません。</div>
                    )}
                    {/* 次フェーズが自フェーズと同一 */}
                    {ctNextPhaseIsSame && (
                      <div style={checkNotice.muted}>進めるフェーズが現在のフェーズと同じです。意図した設定かご確認ください。</div>
                    )}
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

            {/* answers（複数正解。いずれか一致で正解。最低1件・空は保存対象外・trim・重複除外） */}
            <div className="form-group">
              <label style={fieldLabel}>
                答え <RequiredMark />
              </label>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                複数の正解パターンを登録できます（例: りんご / 林檎 / リンゴ / apple）。いずれかに一致すれば正解です。
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {form.answers.map((ans, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="text"
                      className="form-input"
                      value={ans}
                      onChange={(e) => set("answers", form.answers.map((a, j) => (j === i ? e.target.value : a)))}
                      placeholder={i === 0 ? "例: 桜" : "別の正解パターン（任意）"}
                      maxLength={200}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        const next = form.answers.filter((_, j) => j !== i);
                        set("answers", next.length > 0 ? next : [""]);
                      }}
                      disabled={form.answers.length <= 1}
                      title={form.answers.length <= 1 ? "最低1件は必要です" : "この回答を削除"}
                      style={{
                        padding: "6px 10px", fontSize: 12, color: "#ef4444", borderColor: "#fecaca",
                        opacity: form.answers.length <= 1 ? 0.4 : 1,
                        cursor: form.answers.length <= 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
              {form.answers.length < 20 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => set("answers", [...form.answers, ""])}
                  style={{ marginTop: 8, fontSize: 13, padding: "6px 14px" }}
                >
                  ＋ 正解パターンを追加
                </button>
              )}
            </div>

            {/* 照合条件（exact / partial 排他ラジオ） */}
            <div className="form-group">
              <label style={fieldLabel}>照合条件 <RequiredMark /></label>
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
              <label style={fieldLabel}>正解時アクション <RequiredMark /></label>
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
                正解メッセージ <RequiredMark />
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
              {/* 正解メッセージの発話キャラクター（未設定 = 問題本文のキャラ → デフォルト発話者） */}
              <div style={{ marginTop: 10 }}>
                <label style={fieldLabel}>発話キャラクター</label>
                <select
                  className="form-input"
                  value={form.correct_character_id}
                  onChange={(e) => set("correct_character_id", e.target.value)}
                >
                  <option value="">— 問題本文のキャラクターを引き継ぐ —</option>
                  {characters.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>
            </div>
            )}

            {/* correct_next_phase_id */}
            {(form.correct_action === "transition" || form.correct_action === "text_and_transition") && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="correct_next_phase">
                遷移先フェーズ <RequiredMark />
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
              {/* 不正解メッセージの発話キャラクター（未設定 = 問題本文のキャラ → デフォルト発話者） */}
              <div style={{ marginTop: 10 }}>
                <label style={fieldLabel}>発話キャラクター</label>
                <select
                  className="form-input"
                  value={form.incorrect_character_id}
                  onChange={(e) => set("incorrect_character_id", e.target.value)}
                >
                  <option value="">— 問題本文のキャラクターを引き継ぐ —</option>
                  {characters.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 旧「ヒントテキスト」(puzzle_hint_text) の移行案内。
                値があるのにヒント（クイックリプライ）が未設定のときだけ表示し、ワンクリックで移行する。 */}
            {form.puzzle_hint_text.trim() &&
             !form.incorrect_quick_replies.some((i) => i.action === "hint" && i.enabled !== false) && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.6 }}>
                  旧ヒントテキストに内容があります。問題メッセージの下に<strong>ヒントボタン（クイックリプライ）</strong>を表示するには、「ヒント（クイックリプライ）」へ移してください。
                  <span style={{ display: "block", color: "#b45309", marginTop: 2 }}>※「ヒントテキスト」は問題の下には表示されません（プレイヤーが「ヒント」と送ったときの応答用）。</span>
                </div>
                <button type="button" className="btn btn-ghost"
                  style={{ marginTop: 8, fontSize: 12, padding: "5px 12px", color: "#92400e", borderColor: "#fcd34d", background: "#fff" }}
                  onClick={() => {
                    const text = form.puzzle_hint_text.trim();
                    // incorrect_quick_replies に action="hint" を1件追加（保存形式は不変）。
                    set("incorrect_quick_replies", [
                      ...form.incorrect_quick_replies,
                      { action: "hint", label: "ヒント", value: "ヒント", hint_text: text, hint_character_id: null } as QuickReplyItem,
                    ]);
                    // 問題下に常時表示させる + 旧テキストは移行済みとして空にする（UI上）。
                    set("hint_mode", "always");
                    set("puzzle_hint_text", "");
                  }}>
                  ヒント（クイックリプライ）へ移す
                </button>
              </div>
            )}

            {/* ヒント（クイックリプライ）= incorrect_quick_replies（action="hint"）。フラット表示。
                保存形式は従来どおり QuickReplyItem 配列（runtime / 送信 payload には触れない）。 */}
            <HintListEditor
              items={form.incorrect_quick_replies}
              onChange={(items) => set("incorrect_quick_replies", items)}
              characters={characters}
            />

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

            {/* 旧「ヒントテキスト（任意）」(puzzle_hint_text) の入力 UI は廃止（クイックリプライ方式へ統一）。
                ヒントは上の「ヒント（クイックリプライ）」に集約。既存値は保存形式維持のため form 状態に保持し
                （load/save は不変）、移行は上部の案内バナーから行う。runtime/webhook の旧 fallback は不変。 */}
          </SectionAccordion>
          )} {/* /isPuzzle 謎の回答設定 */}

          {/* ── メッセージ後の遷移（送信直後）── */}
          {/* 「送信後の挙動」の設定。連続メッセージ全体（1通目＋2通目以降）を送り終わった直後に発火する
              ブロック全体で1つの設定として配置する（各スロットには出さない）。保存時にチェーン末尾へ正規化。
              直上の「送信後に地点到着を待つ（自動進行）」等と同じ SectionAccordion（白カード・任意）に揃える。
              ※ キーワード/QR 起点の旧「遷移を追加」UI（PhaseTransitionsSection）は新UIと紛らわしいため
                通常メッセージ編集画面では非表示（Transition テーブル・runtime・scenario flow 側は不変）。 */}
          <SectionAccordion
            title="メッセージ後の遷移（送信直後）"
            optional
            description="このメッセージ群をすべて送信した直後に、入力を待たず指定フェーズへ移動します。"
            defaultOpen={false}
            badge={form.auto_transition_phase_id
              ? <span style={{ fontSize: 10, fontWeight: 700, background: "#06C755", color: "#fff", borderRadius: 10, padding: "1px 7px" }}>設定済み</span>
              : undefined}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="auto_transition_phase_id">移動先フェーズ</label>
              <select
                id="auto_transition_phase_id"
                className="form-input"
                style={{ maxWidth: 320 }}
                value={form.auto_transition_phase_id}
                onChange={(e) => set("auto_transition_phase_id", e.target.value)}
              >
                <option value="">移動しない</option>
                {(phases ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div style={hintText}>
                このメッセージ群をすべて送信した直後に、プレイヤーの入力やボタン操作を待たず、指定フェーズへ移動します。
                移動先フェーズの冒頭メッセージは送信されません。「続きを選んでください。」も表示されません。
                次の入力から、移動先フェーズの応答キーワードが有効になります。
              </div>
            </div>
          </SectionAccordion>

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
              <Link href={messagesBackHref} className="btn btn-ghost">
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
            oaTitle={oaTitle}
            workTitle={workTitle}
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
