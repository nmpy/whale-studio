// src/app/oas/[id]/works/[workId]/messages/_form-helpers.ts
//
// _form.tsx (大規模 + JSX) からテスト容易な純関数だけ切り出した helper モジュール。
// vitest は bracket route パス (`[id]` 等) を含む .tsx の import 解析が苦手なため、
// テスト対象の純関数は本ファイルに置く。_form.tsx 側は本ファイルから再 export する。
//
// 役割:
//   - AdditionalMessageSlot 型 (= 2 通目以降の編集 form state, 1 件分)
//   - msgToAdditionalSlot: API レスポンス 1 件を AdditionalMessageSlot に変換
//   - additionalSlotToMsgBody: AdditionalMessageSlot を /api/messages 用 body に整形

import type { ReadReceiptMode } from "@/types";

// ── 型定義 (= _form.tsx と共有) ─────────────────────────────

export type ExtendedMessageType = "text" | "image" | "video" | "voice" | "carousel" | "riddle";

export type MessageKindHelper =
  "start" | "normal" | "response" | "hint" | "puzzle" | "global" | "system_notice";

export interface MessageCarouselCard {
  image_url:    string;
  title:        string;
  body:         string;
  button_label: string;
  button_url:   string;
  destination_id?: string | null;
}

/** 2 通目以降のメッセージスロット (= 編集画面で chain を持つときの 1 件分の form state)。
 *
 *  1 通目 (= MessageFormState 直下) と同じ timing フィールドを持つことで、
 *  「2 通目以降にも個別に演出設定できる」要件を満たす。
 *  空文字 ("") = inherit (= 作品 / OA デフォルトを継承)。
 */
export interface AdditionalMessageSlot {
  /** 既存メッセージ ID (= 編集モードで chain 復元時に設定される)。空 = 新規 slot */
  existingId?:    string;
  /** この発話のキャラクター ID (= 空文字なら 1 通目を引き継ぐ) */
  character_id:   string;
  message_type:   ExtendedMessageType;
  body:           string;
  asset_url:      string;
  notify_text:    string;
  carousel_items: MessageCarouselCard[];
  /** 前のメッセージ送信後この発話まで待機する ms。0 = 即時送信 */
  lag_ms:         number;
  // ── 演出設定 (空文字 = inherit、明示 "true"/"false" / 数値文字列で上書き) ──
  read_receipt_mode:    string; // "" = inherit / "immediate" / "delayed" / "before_reply"
  read_delay_ms:        string; // "" = inherit (数値入力との兼用)
  typing_enabled:       string; // "" = inherit, "true", "false"
  typing_min_ms:        string;
  typing_max_ms:        string;
  loading_enabled:      string; // "" = inherit, "true", "false"
  loading_threshold_ms: string;
  loading_min_seconds:  string;
  loading_max_seconds:  string;
  // ── 自由入力受付 (= chain continuation でも freeInput プロンプトに設定可能にする) ──
  // 例: 「{{user_name}}さんにより画像がタップされました」(chain head, freeInput=false)
  //   → 「xxについてどう思う？」(chain continuation, freeInput=true) のような構成。
  // main message と完全に同形。空文字 / false がデフォルト。
  free_input_enabled:         boolean;
  free_input_variable_key:    string;
  free_input_next_message_id: string;
}

export const EMPTY_ADDITIONAL_SLOT: AdditionalMessageSlot = {
  character_id:   "",
  message_type:   "text",
  body:           "",
  asset_url:      "",
  notify_text:    "",
  carousel_items: [],
  lag_ms:         0,
  // 演出設定 (= 空文字で inherit を意味する)
  read_receipt_mode:    "",
  read_delay_ms:        "",
  typing_enabled:       "",
  typing_min_ms:        "",
  typing_max_ms:        "",
  loading_enabled:      "",
  loading_threshold_ms: "",
  loading_min_seconds:  "",
  loading_max_seconds:  "",
  // 自由入力受付 (デフォルト OFF)
  free_input_enabled:         false,
  free_input_variable_key:    "",
  free_input_next_message_id: "",
};

// ── 純関数 helper ────────────────────────────────────────

/** Message API レスポンス (1 件) を AdditionalMessageSlot に変換する。
 *  chain の 2 通目以降を編集 form に復元する際に使う。
 *
 *  正規化:
 *    - null / undefined → 空文字 (= inherit)
 *    - boolean → "true" / "false" 文字列 (= UI select 用)
 *    - number → 文字列化
 *    - 空 body / null body → 空文字 (= 既存挙動)
 */
export function msgToAdditionalSlot(msg: {
  id?:               string | null;
  character_id?:     string | null;
  message_type?:     string;
  body?:             string | null;
  asset_url?:        string | null;
  notify_text?:      string | null;
  lag_ms?:           number | null;
  read_receipt_mode?:    string | null;
  read_delay_ms?:        number | null;
  typing_enabled?:       boolean | null;
  typing_min_ms?:        number | null;
  typing_max_ms?:        number | null;
  loading_enabled?:      boolean | null;
  loading_threshold_ms?: number | null;
  loading_min_seconds?:  number | null;
  loading_max_seconds?:  number | null;
  // 自由入力受付 (chain continuation でも main message と同様に設定可能)
  free_input_enabled?:         boolean | null;
  free_input_variable_key?:    string  | null;
  free_input_next_message_id?: string  | null;
}): AdditionalMessageSlot {
  let carousel_items: MessageCarouselCard[] = [];
  if (msg.message_type === "carousel" && msg.body) {
    try {
      const parsed = JSON.parse(msg.body);
      if (Array.isArray(parsed)) carousel_items = parsed as MessageCarouselCard[];
    } catch {
      carousel_items = [];
    }
  }
  return {
    existingId:     msg.id ?? undefined,
    character_id:   msg.character_id ?? "",
    message_type:   (msg.message_type as ExtendedMessageType) ?? "text",
    body:           msg.message_type === "carousel" ? "" : (msg.body ?? ""),
    asset_url:      msg.asset_url   ?? "",
    notify_text:    msg.notify_text ?? "",
    carousel_items,
    lag_ms:         msg.lag_ms ?? 0,
    // 演出設定 (null → 空文字 = inherit)。
    // boolean は明示的に "true"/"false" で保持して、後段で `=== "true"` 判定する。
    // (= 単に Boolean cast すると false が空文字と区別できなくなる)
    read_receipt_mode:    msg.read_receipt_mode ?? "",
    read_delay_ms:        msg.read_delay_ms != null ? String(msg.read_delay_ms) : "",
    typing_enabled:       msg.typing_enabled != null ? String(msg.typing_enabled) : "",
    typing_min_ms:        msg.typing_min_ms != null ? String(msg.typing_min_ms) : "",
    typing_max_ms:        msg.typing_max_ms != null ? String(msg.typing_max_ms) : "",
    loading_enabled:      msg.loading_enabled != null ? String(msg.loading_enabled) : "",
    loading_threshold_ms: msg.loading_threshold_ms != null ? String(msg.loading_threshold_ms) : "",
    loading_min_seconds:  msg.loading_min_seconds != null ? String(msg.loading_min_seconds) : "",
    loading_max_seconds:  msg.loading_max_seconds != null ? String(msg.loading_max_seconds) : "",
    // 自由入力受付 (null → false / 空文字。DB 値があれば form state に復元する)
    free_input_enabled:         msg.free_input_enabled         ?? false,
    free_input_variable_key:    msg.free_input_variable_key    ?? "",
    free_input_next_message_id: msg.free_input_next_message_id ?? "",
  };
}

/** AdditionalMessageSlot を /api/messages の create/update body に整形する。
 *  edit page / new page の handleSubmit から共通利用する。
 *
 *  仕様:
 *    - 空文字 → null (= inherit)
 *    - "true"/"false" → boolean (= 明示値は維持)
 *    - 数値文字列 → number
 *    - body は message_type に応じて include/exclude
 */
export function additionalSlotToMsgBody(
  slot: AdditionalMessageSlot,
  main: {
    work_id:      string;
    phase_id:     string | null;
    character_id: string | null;
    kind:         Exclude<MessageKindHelper, "global">;
    sort_order:   number;
    is_active:    boolean;
  },
): {
  work_id:      string;
  phase_id:     string | null;
  character_id: string | null;
  kind:         Exclude<MessageKindHelper, "global">;
  message_type: ExtendedMessageType;
  body?:        string;
  asset_url?:   string;
  notify_text?: string;
  lag_ms:       number;
  sort_order:   number;
  is_active:    boolean;
  read_receipt_mode:    ReadReceiptMode | null;
  read_delay_ms:        number | null;
  typing_enabled:       boolean | null;
  typing_min_ms:        number | null;
  typing_max_ms:        number | null;
  loading_enabled:      boolean | null;
  loading_threshold_ms: number | null;
  loading_min_seconds:  number | null;
  loading_max_seconds:  number | null;
  // 自由入力受付 (main message と同形)
  free_input_enabled:         boolean;
  free_input_variable_key:    string | null;
  free_input_next_message_id: string | null;
} {
  return {
    work_id:      main.work_id,
    phase_id:     main.phase_id,
    // slot.character_id が空文字なら main を引き継ぐ
    character_id: slot.character_id || main.character_id,
    kind:         main.kind,
    message_type: slot.message_type,
    body:
      slot.message_type === "carousel"
        ? JSON.stringify(slot.carousel_items)
        : slot.message_type === "text"
        ? (slot.body || undefined)
        : undefined,
    asset_url:
      slot.message_type === "image" || slot.message_type === "video" || slot.message_type === "voice"
        ? (slot.asset_url || undefined)
        : undefined,
    notify_text:  slot.message_type !== "text" ? (slot.notify_text || undefined) : undefined,
    lag_ms:       slot.lag_ms,
    sort_order:   main.sort_order,
    is_active:    main.is_active,
    // 演出設定 (空文字 → null = inherit、明示 false は false で保存)
    read_receipt_mode:    (slot.read_receipt_mode || null) as ReadReceiptMode | null,
    read_delay_ms:        slot.read_delay_ms ? Number(slot.read_delay_ms) : null,
    typing_enabled:
      slot.typing_enabled === "true"  ? true
      : slot.typing_enabled === "false" ? false
      : null,
    typing_min_ms:        slot.typing_min_ms ? Number(slot.typing_min_ms) : null,
    typing_max_ms:        slot.typing_max_ms ? Number(slot.typing_max_ms) : null,
    loading_enabled:
      slot.loading_enabled === "true"  ? true
      : slot.loading_enabled === "false" ? false
      : null,
    loading_threshold_ms: slot.loading_threshold_ms ? Number(slot.loading_threshold_ms) : null,
    loading_min_seconds:  slot.loading_min_seconds ? Number(slot.loading_min_seconds) : null,
    loading_max_seconds:  slot.loading_max_seconds ? Number(slot.loading_max_seconds) : null,
    // 自由入力受付 (main message と同じ仕様: ON のときのみ key / next を保存)
    free_input_enabled:         !!slot.free_input_enabled,
    free_input_variable_key:    slot.free_input_enabled ? (slot.free_input_variable_key.trim() || null) : null,
    free_input_next_message_id: slot.free_input_enabled ? (slot.free_input_next_message_id || null) : null,
  };
}
