// src/app/oas/[id]/works/[workId]/messages/_form-helpers.ts
//
// _form.tsx (1500+ 行 + JSX) からテスト容易な純関数だけ切り出した helper モジュール。
// vitest は bracket route パス (`[id]` 等) を含む .tsx の import 解析が苦手なため、
// テスト対象の純関数は本ファイルに置く。_form.tsx 側は本ファイルから再 export する。
//
// 役割:
//   - msgToAdditionalSlot: API レスポンスの 1 メッセージを AdditionalMessageSlot に正規化
//   - additionalSlotToMsgBody: AdditionalMessageSlot を /api/messages 用 body に整形

import type { QuickReplyItem, MessageTimingConfig, ReadReceiptMode } from "@/types";

// ── 型 ──────────────────────────────────────────────────

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

export interface AdditionalMessageSlot {
  existingId?:    string;
  character_id:   string;
  message_type:   ExtendedMessageType;
  body:           string;
  asset_url:      string;
  notify_text:    string;
  carousel_items: MessageCarouselCard[];
  lag_ms:         number;
  read_receipt_mode:    string;
  read_delay_ms:        string;
  typing_enabled:       string;
  typing_min_ms:        string;
  typing_max_ms:        string;
  loading_enabled:      string;
  loading_threshold_ms: string;
  loading_min_seconds:  string;
  loading_max_seconds:  string;
}

export const EMPTY_ADDITIONAL_SLOT: AdditionalMessageSlot = {
  character_id:   "",
  message_type:   "text",
  body:           "",
  asset_url:      "",
  notify_text:    "",
  carousel_items: [],
  lag_ms:         0,
  read_receipt_mode:    "",
  read_delay_ms:        "",
  typing_enabled:       "",
  typing_min_ms:        "",
  typing_max_ms:        "",
  loading_enabled:      "",
  loading_threshold_ms: "",
  loading_min_seconds:  "",
  loading_max_seconds:  "",
};

// ── 純関数 helper ────────────────────────────────────────

/** Message API レスポンス (1 件) を AdditionalMessageSlot に変換する。
 *  チェーンの 2 通目以降をフォームに復元する際に使う。 */
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
    read_receipt_mode:    msg.read_receipt_mode ?? "",
    read_delay_ms:        msg.read_delay_ms != null ? String(msg.read_delay_ms) : "",
    typing_enabled:       msg.typing_enabled != null ? String(msg.typing_enabled) : "",
    typing_min_ms:        msg.typing_min_ms != null ? String(msg.typing_min_ms) : "",
    typing_max_ms:        msg.typing_max_ms != null ? String(msg.typing_max_ms) : "",
    loading_enabled:      msg.loading_enabled != null ? String(msg.loading_enabled) : "",
    loading_threshold_ms: msg.loading_threshold_ms != null ? String(msg.loading_threshold_ms) : "",
    loading_min_seconds:  msg.loading_min_seconds != null ? String(msg.loading_min_seconds) : "",
    loading_max_seconds:  msg.loading_max_seconds != null ? String(msg.loading_max_seconds) : "",
  };
}

/** AdditionalMessageSlot を /api/messages の create/update body に変換する。 */
export function additionalSlotToMsgBody(
  slot: AdditionalMessageSlot,
  main: { work_id: string; phase_id: string | null; character_id: string | null;
          kind: Exclude<MessageKindHelper, "global">;
          sort_order: number; is_active: boolean }
): {
  work_id: string; phase_id: string | null; character_id: string | null;
  kind: Exclude<MessageKindHelper, "global">;
  message_type: ExtendedMessageType;
  body?: string; asset_url?: string; notify_text?: string;
  lag_ms: number; sort_order: number; is_active: boolean;
  read_receipt_mode: ReadReceiptMode | null;
  read_delay_ms: number | null;
  typing_enabled: boolean | null;
  typing_min_ms: number | null;
  typing_max_ms: number | null;
  loading_enabled: boolean | null;
  loading_threshold_ms: number | null;
  loading_min_seconds: number | null;
  loading_max_seconds: number | null;
} {
  return {
    work_id:      main.work_id,
    phase_id:     main.phase_id,
    character_id: slot.character_id || main.character_id,
    kind:         main.kind,
    message_type: slot.message_type,
    body:         slot.message_type === "carousel"
      ? JSON.stringify(slot.carousel_items)
      : slot.message_type === "text" ? (slot.body || undefined) : undefined,
    asset_url:    (slot.message_type === "image" || slot.message_type === "video" || slot.message_type === "voice")
      ? (slot.asset_url || undefined) : undefined,
    notify_text:  slot.message_type !== "text" ? (slot.notify_text || undefined) : undefined,
    lag_ms:       slot.lag_ms,
    sort_order:   main.sort_order,
    is_active:    main.is_active,
    read_receipt_mode:    (slot.read_receipt_mode || null) as ReadReceiptMode | null,
    read_delay_ms:        slot.read_delay_ms ? Number(slot.read_delay_ms) : null,
    typing_enabled:       slot.typing_enabled === "true" ? true : slot.typing_enabled === "false" ? false : null,
    typing_min_ms:        slot.typing_min_ms ? Number(slot.typing_min_ms) : null,
    typing_max_ms:        slot.typing_max_ms ? Number(slot.typing_max_ms) : null,
    loading_enabled:      slot.loading_enabled === "true" ? true : slot.loading_enabled === "false" ? false : null,
    loading_threshold_ms: slot.loading_threshold_ms ? Number(slot.loading_threshold_ms) : null,
    loading_min_seconds:  slot.loading_min_seconds ? Number(slot.loading_min_seconds) : null,
    loading_max_seconds:  slot.loading_max_seconds ? Number(slot.loading_max_seconds) : null,
  };
}

// 不要 export を消す代わりに、_form.tsx 側で使うために型/値も再 export 可能にする
export type { QuickReplyItem, MessageTimingConfig, ReadReceiptMode };
