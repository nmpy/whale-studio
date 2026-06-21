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
import { normalizeFlexJson, prettyFlexJson } from "@/lib/flex";
import {
  normalizeCarouselContent, serializeCarouselContent,
  type CarouselCardType, type CarouselCard,
} from "@/lib/carousel";

// ── 型定義 (= _form.tsx と共有) ─────────────────────────────

export type ExtendedMessageType = "text" | "image" | "video" | "voice" | "carousel" | "riddle" | "flex";

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
  /** 旧形式カード（後方互換のため保持。新規は carousel_cards を使う）。 */
  carousel_items: MessageCarouselCard[];
  /** 通常メッセージ carousel のカードタイプ（連続メッセージは常に通常扱い）。 */
  carousel_card_type: CarouselCardType;
  /** 通常メッセージ carousel のカード（src/lib/carousel の新形式）。 */
  carousel_cards: CarouselCard[];
  // ── Flex Message (message_type="flex" 用) ──
  /** 代替テキスト（altText）。flex のとき必須。 */
  alt_text:       string;
  /** 貼り付け JSON (bubble/carousel または flex 全体)。編集時は整形済みで復元。 */
  flex_payload_json: string;
  /** 前のメッセージ送信後この発話まで待機する ms。0 = 即時送信 */
  lag_ms:         number;
  // ── 演出設定 (空文字 = inherit、明示 "true"/"false" / 数値文字列で上書き) ──
  // 継承モード廃止: read_receipt_mode は常に "immediate"/"delayed"/"before_reply"、
  // typing_enabled / loading_enabled は "true" / "false"。数値は空文字 = 未指定。
  read_receipt_mode:    string; // "immediate" (OFF) | "delayed" | "before_reply"
  read_delay_ms:        string;
  typing_enabled:       string; // "true" | "false"
  typing_min_ms:        string;
  typing_max_ms:        string;
  loading_enabled:      string; // "true" | "false"
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
  carousel_card_type: "product",
  carousel_cards: [],
  alt_text:           "",
  flex_payload_json:  "",
  lag_ms:         0,
  // 演出設定 (= 継承モード廃止: すべて OFF 相当を初期値とする)
  read_receipt_mode:    "immediate", // = OFF (人為的な既読遅延なし)
  read_delay_ms:        "",
  typing_enabled:       "false",
  typing_min_ms:        "",
  typing_max_ms:        "",
  loading_enabled:      "false",
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
 *  正規化 (= 継承モード廃止):
 *    - read_receipt_mode: null / 旧 "inherit" → "immediate" (= OFF)
 *    - typing_enabled / loading_enabled: null → "false" (= OFF)
 *    - 数値フィールド: null → 空文字 (= 未指定、runtime 固定デフォルトを使用)
 *    - 空 body / null body → 空文字 (= 既存挙動)
 */
export function msgToAdditionalSlot(msg: {
  id?:               string | null;
  character_id?:     string | null;
  message_type?:     string;
  body?:             string | null;
  asset_url?:        string | null;
  notify_text?:      string | null;
  alt_text?:         string | null;
  flex_payload_json?: string | null;
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
  // 連続メッセージ（slot）は常に通常 carousel 扱い → 新形式 carousel_cards に正規化（旧形式も安全に復元）。
  let carousel_items: MessageCarouselCard[] = [];
  let carousel_card_type: CarouselCardType = "product";
  let carousel_cards: CarouselCard[] = [];
  if (msg.message_type === "carousel" && msg.body) {
    try {
      const parsed = JSON.parse(msg.body);
      if (Array.isArray(parsed)) carousel_items = parsed as MessageCarouselCard[];
    } catch {
      carousel_items = [];
    }
    const c = normalizeCarouselContent(msg.body);
    carousel_card_type = c.cardType;
    carousel_cards = c.cards;
  }
  return {
    existingId:     msg.id ?? undefined,
    character_id:   msg.character_id ?? "",
    message_type:   (msg.message_type as ExtendedMessageType) ?? "text",
    body:           msg.message_type === "carousel" ? "" : (msg.body ?? ""),
    asset_url:      msg.asset_url   ?? "",
    notify_text:    msg.notify_text ?? "",
    carousel_items,
    carousel_card_type,
    carousel_cards,
    alt_text:           msg.alt_text ?? "",
    flex_payload_json:  prettyFlexJson(msg.flex_payload_json),
    lag_ms:         msg.lag_ms ?? 0,
    // 演出設定 (= 継承モード廃止: null / 旧 "inherit" は OFF 相当に正規化)。
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
  alt_text:          string | null;
  flex_payload_json: string | null;
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
        // 連続メッセージは通常 carousel → 新形式 {type,cardType,cards} で保存。
        ? serializeCarouselContent({ type: "carousel", cardType: slot.carousel_card_type, cards: slot.carousel_cards })
        : slot.message_type === "text"
        ? (slot.body || undefined)
        : undefined,
    asset_url:
      slot.message_type === "image" || slot.message_type === "video" || slot.message_type === "voice"
        ? (slot.asset_url || undefined)
        : undefined,
    notify_text:  (slot.message_type !== "text" && slot.message_type !== "flex") ? (slot.notify_text || undefined) : undefined,
    // Flex Message: altText と contents (正規化) を保存。flex 以外は null。
    alt_text:     slot.message_type === "flex" ? (slot.alt_text.trim() || null) : null,
    flex_payload_json:
      slot.message_type === "flex"
        ? (() => {
            const n = normalizeFlexJson(slot.flex_payload_json);
            return n.ok ? JSON.stringify(n.value.contents) : (slot.flex_payload_json.trim() || null);
          })()
        : null,
    lag_ms:       slot.lag_ms,
    sort_order:   main.sort_order,
    is_active:    main.is_active,
    // 演出設定 (= 継承モード廃止: slot は常に明示値 "immediate"/"true"/"false" 等を持つ。
    // 数値フィールドは空文字なら null = 未指定、runtime 固定デフォルトを使用)。
    read_receipt_mode:    (slot.read_receipt_mode || null) as ReadReceiptMode | null,
    read_delay_ms:        slot.read_delay_ms ? Number(slot.read_delay_ms) : null,
    typing_enabled:       slot.typing_enabled === "true" ? true : false,
    typing_min_ms:        slot.typing_min_ms ? Number(slot.typing_min_ms) : null,
    typing_max_ms:        slot.typing_max_ms ? Number(slot.typing_max_ms) : null,
    loading_enabled:      slot.loading_enabled === "true" ? true : false,
    loading_threshold_ms: slot.loading_threshold_ms ? Number(slot.loading_threshold_ms) : null,
    loading_min_seconds:  slot.loading_min_seconds ? Number(slot.loading_min_seconds) : null,
    loading_max_seconds:  slot.loading_max_seconds ? Number(slot.loading_max_seconds) : null,
    // 自由入力受付 (main message と同じ仕様: ON のときのみ key / next を保存)
    free_input_enabled:         !!slot.free_input_enabled,
    free_input_variable_key:    slot.free_input_enabled ? (slot.free_input_variable_key.trim() || null) : null,
    free_input_next_message_id: slot.free_input_enabled ? (slot.free_input_next_message_id || null) : null,
  };
}

/** 「演出設定」セクションヘッダーの「設定あり」バッジ判定（編集 form の string 値ベース）。
 *
 *  一覧バッジ hasAnyTiming (_list-helpers.ts) と同じ「実際に効果がある設定のみ true」の意味に揃える。
 *  継承モード廃止後、form の各値は常に明示文字列を持つため（"immediate"/"false" 等）、
 *  単純な truthy 判定だと OFF でも「設定あり」になってしまう（"false" は truthy）。
 *
 *  - read_receipt_mode: "delayed" / "before_reply" のみ効果あり（"immediate"=即時/OFF・""=inherit は false）
 *  - typing_enabled / loading_enabled: 文字列 "true" のみ（"false"=OFF は false）
 *  ※ 待機時間(lag_ms)は別バッジ(hasHeadDelay)で扱うため本関数には含めない。
 */
export function timingFormHasEffect(form: {
  read_receipt_mode?: string;
  typing_enabled?:    string;
  loading_enabled?:   string;
}): boolean {
  return (
    form.read_receipt_mode === "delayed" ||
    form.read_receipt_mode === "before_reply" ||
    form.typing_enabled === "true" ||
    form.loading_enabled === "true"
  );
}
