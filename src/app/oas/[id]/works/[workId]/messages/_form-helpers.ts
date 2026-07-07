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

/**
 * 2通目以降（チェーン）の発話キャラクター選択の UI 内部 sentinel。
 * slot.character_id の値の意味:
 *   ""                 = 1通目のキャラクターを引き継ぐ（従来どおり・新規既定）
 *   CHAIN_SPEAKER_NONE = キャラクターを指定しない（保存時 null = デフォルト表示）
 *   <characterId>      = 登録済みキャラクターを指定
 * DB にはこの sentinel を保存しない（additionalSlotToMsgBody で null に変換する）。
 */
export const CHAIN_SPEAKER_NONE = "__none__";

export type ExtendedMessageType = "text" | "image" | "video" | "voice" | "carousel" | "riddle" | "flex" | "call_request";

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
  /** この発話のキャラクター ID。"" = 1通目を引き継ぐ / CHAIN_SPEAKER_NONE = 指定しない(=null保存) / id = 指定 */
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
  // ── 画像タップ時アクション (image_action) — message_type="image" 用。1通目と同形。 ──
  // "" = なし / "uri" = URLを開く / "message" = メッセージを送信する / "message_with_phase" = 送信＋フェーズ遷移
  // （message / message_with_phase は末尾メッセージのみ）。
  image_action_type: "" | "message" | "uri" | "liff" | "postback" | "message_with_phase";
  image_action_text: string;
  image_action_url:  string;
  /** type="message_with_phase" 用: 遷移先フェーズ ID。 */
  image_action_phase_id: string;
  /** このメッセージ送信後に silent 自動遷移する先フェーズ ID（""＝移動しない）。チェーン末尾に設定する想定。 */
  auto_transition_phase_id: string;
  // ── 自由入力受付 (= chain continuation でも freeInput プロンプトに設定可能にする) ──
  // 例: 「{{user_name}}さんにより画像がタップされました」(chain head, freeInput=false)
  //   → 「xxについてどう思う？」(chain continuation, freeInput=true) のような構成。
  // main message と完全に同形。空文字 / false がデフォルト。
  free_input_enabled:         boolean;
  free_input_variable_key:    string;
  free_input_next_message_id: string;
  /** 時間差メッセージ（予約送信）設定。1通目と同形。slot にも「N分後フォローアップ」を付けられる。
   *  ※「このメッセージ自体を遅延配信」ではなく「送信後に別メッセージを push 予約」する設定。 */
  scheduled_message:          ScheduledMessageFormState;
}

/** 2通目以降の「前のメッセージからの待機時間」(lag_ms) で新規設定できる最大値（ms）。
 *  これを超える長時間待機は webhook を長時間保持し 504 を招くため、予約送信（ScheduledLineMessage）へ誘導する。
 *  既存データが超過していても自動クリアはしない（読み取り専用表示）。 */
export const SLOT_LAG_MS_MAX = 8000;
/** slot lag の秒入力で指定できる最大秒数（= SLOT_LAG_MS_MAX）。 */
export const SLOT_LAG_SECONDS_MAX = SLOT_LAG_MS_MAX / 1000;

/** slot lag の「新規入力」を 0〜SLOT_LAG_MS_MAX(8秒) に丸める（分入力を排した秒のみ UI と保存の両方で使用）。
 *  非有限/負は 0、超過は 8000ms に clamp。既存 >8秒 の読み取り専用値には適用しない（呼び出し側で分岐）。 */
export function clampNewSlotLagMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(Math.floor(ms), SLOT_LAG_MS_MAX);
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
  // 画像タップ時アクション (デフォルト なし)
  image_action_type: "",
  image_action_text: "",
  image_action_url:  "",
  image_action_phase_id: "",
  auto_transition_phase_id: "",
  // 自由入力受付 (デフォルト OFF)
  free_input_enabled:         false,
  free_input_variable_key:    "",
  free_input_next_message_id: "",
  // 時間差メッセージ（予約送信）。= EMPTY_SCHEDULED_MESSAGE を inline（TDZ 回避・後方に const 定義あり）。
  scheduled_message:          { enabled: false, delay_minutes: 30, body: "", character_id: "", cancel_on_phase_change: false, cancel_on_work_completed: false, hold_chain_until_sent: false },
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
  // 画像タップ時アクション（+ 旧 tap_* は後方互換のため uri へ読み替える）
  image_action_type?:        string | null;
  image_action_text?:        string | null;
  image_action_url?:         string | null;
  image_action_phase_id?:    string | null;
  auto_transition_phase_id?: string | null;
  tap_url?:                  string | null;
  tap_destination_id?:       string | null;
  // 自由入力受付 (chain continuation でも main message と同様に設定可能)
  free_input_enabled?:         boolean | null;
  free_input_variable_key?:    string  | null;
  free_input_next_message_id?: string  | null;
  // 時間差メッセージ（予約送信）。API レスポンスは parse 済み object | null。
  scheduled_message_settings?: unknown;
}, resolveDestinationUrl?: (id: string) => string | null): AdditionalMessageSlot {
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
    // 復元: null = 「キャラクターを指定しない」(sentinel) / id = 指定キャラ。
    // （空文字 "" = 引き継ぎは新規 slot の初期値であり、DB には null か id しか入らない。
    //   過去に「引き継ぐ」で保存されたものは実体 id として保存済みのため、そのキャラ選択で復元される。）
    character_id:   msg.character_id ?? CHAIN_SPEAKER_NONE,
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
    // 画像タップ時アクション。image_action があればそれを、無ければ旧 tap_*（URL/遷移先）を
    // 「URLを開く(uri)」として後方互換で読み込む（保存時に統一形式へ寄せる）。
    ...(() => {
      const at = msg.image_action_type;
      if (at === "message" || at === "uri" || at === "liff" || at === "postback" || at === "message_with_phase") {
        return {
          image_action_type: at,
          image_action_text: msg.image_action_text ?? "",
          image_action_url:  msg.image_action_url ?? "",
          image_action_phase_id: at === "message_with_phase" ? (msg.image_action_phase_id ?? "") : "",
        };
      }
      const legacyUrl = (msg.tap_url?.trim())
        || (msg.tap_destination_id ? (resolveDestinationUrl?.(msg.tap_destination_id) ?? "") : "");
      if (legacyUrl) return { image_action_type: "uri" as const, image_action_text: "", image_action_url: legacyUrl, image_action_phase_id: "" };
      return { image_action_type: "" as const, image_action_text: "", image_action_url: "", image_action_phase_id: "" };
    })(),
    // 送信後の silent 自動フェーズ遷移（null → 空文字＝移動しない。DB 値があれば復元）。
    auto_transition_phase_id:   msg.auto_transition_phase_id ?? "",
    // 自由入力受付 (null → false / 空文字。DB 値があれば form state に復元する)
    free_input_enabled:         msg.free_input_enabled         ?? false,
    free_input_variable_key:    msg.free_input_variable_key    ?? "",
    free_input_next_message_id: msg.free_input_next_message_id ?? "",
    // 時間差メッセージ（予約送信）。1通目と同じ converter で復元（再編集で値が戻る）。
    scheduled_message:          scheduledSettingsToFormState(msg.scheduled_message_settings),
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
  // 画像タップ時アクション（image のみ。type 空 = なし → null）
  image_action_type: "message" | "uri" | "liff" | "postback" | "message_with_phase" | null;
  image_action_text: string | null;
  image_action_url:  string | null;
  image_action_phase_id: string | null;
  auto_transition_phase_id: string | null;
  // 自由入力受付 (main message と同形)
  free_input_enabled:         boolean;
  free_input_variable_key:    string | null;
  free_input_next_message_id: string | null;
  // 時間差メッセージ（予約送信）。1通目と同じ converter で保存（未操作なら null で DB を汚さない）。
  scheduled_message_settings: ReturnType<typeof formStateToScheduledSettings>;
} {
  return {
    work_id:      main.work_id,
    phase_id:     main.phase_id,
    // 発話キャラクターの三分岐:
    //   CHAIN_SPEAKER_NONE = 指定しない → null（デフォルト表示）
    //   "" (空文字)        = 1通目を引き継ぐ → main.character_id（後方互換・従来どおり）
    //   <characterId>      = 指定キャラ → その id
    character_id:
      slot.character_id === CHAIN_SPEAKER_NONE ? null
      : slot.character_id ? slot.character_id
      : main.character_id,
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
    // 画像タップ時アクション（image かつ type 設定時のみ保存。uri→url / message・message_with_phase→text /
    // message_with_phase→phase_id。それ以外 null）
    image_action_type:
      slot.message_type === "image" && (slot.image_action_type === "message" || slot.image_action_type === "uri" || slot.image_action_type === "message_with_phase")
        ? slot.image_action_type
        : null,
    image_action_text:
      slot.message_type === "image" && (slot.image_action_type === "message" || slot.image_action_type === "message_with_phase")
        ? (slot.image_action_text.trim() || null)
        : null,
    image_action_url:
      slot.message_type === "image" && slot.image_action_type === "uri"
        ? (slot.image_action_url.trim() || null)
        : null,
    image_action_phase_id:
      slot.message_type === "image" && slot.image_action_type === "message_with_phase"
        ? (slot.image_action_phase_id.trim() || null)
        : null,
    // 送信後の silent 自動フェーズ遷移（message_type 非依存。""＝移動しない → null）。
    auto_transition_phase_id: slot.auto_transition_phase_id.trim() || null,
    // 自由入力受付 (main message と同じ仕様: ON のときのみ key / next を保存)
    free_input_enabled:         !!slot.free_input_enabled,
    free_input_variable_key:    slot.free_input_enabled ? (slot.free_input_variable_key.trim() || null) : null,
    free_input_next_message_id: slot.free_input_enabled ? (slot.free_input_next_message_id || null) : null,
    // 時間差メッセージ（予約送信）。chain API（PUT /api/messages/chain）が per-item で永続化する。
    scheduled_message_settings: formStateToScheduledSettings(slot.scheduled_message),
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

// ── 時間差メッセージ（予約送信）設定（PR-4c-1: 保存のみ・runtime 未使用）────────────────
// push 配信＝通数消費。実予約作成・送信は次 PR で接続する。純関数のためここ（テスト可能な helpers）に置く。

/** 時間差メッセージ設定のフォーム状態。 */
export interface ScheduledMessageFormState {
  enabled:                  boolean;
  /** 送信タイミング（分）。1〜10080。 */
  delay_minutes:            number;
  body:                     string;
  /** 発話キャラクター ID（"" = 本文と同じ/デフォルト）。 */
  character_id:             string;
  cancel_on_phase_change:   boolean;
  cancel_on_work_completed: boolean;
  /** PR-SER1（保存のみ・runtime 未接続）: ON で「この予約が届くまで後続を止める」直列進行。 */
  hold_chain_until_sent:    boolean;
}

export const EMPTY_SCHEDULED_MESSAGE: ScheduledMessageFormState = {
  enabled: false, delay_minutes: 30, body: "", character_id: "",
  cancel_on_phase_change: false, cancel_on_work_completed: false,
  hold_chain_until_sent: false,
};

/** API レスポンスの scheduled_message_settings（object | null）→ フォーム状態へ正規化。 */
export function scheduledSettingsToFormState(raw: unknown): ScheduledMessageFormState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SCHEDULED_MESSAGE };
  const s = raw as Record<string, unknown>;
  return {
    enabled:                  s.enabled === true,
    delay_minutes:            typeof s.delay_minutes === "number" && Number.isInteger(s.delay_minutes) && s.delay_minutes >= 1 && s.delay_minutes <= 10080
                                ? s.delay_minutes : EMPTY_SCHEDULED_MESSAGE.delay_minutes,
    body:                     typeof s.body === "string" ? s.body : "",
    character_id:             typeof s.character_id === "string" ? s.character_id : "",
    cancel_on_phase_change:   s.cancel_on_phase_change === true,
    cancel_on_work_completed: s.cancel_on_work_completed === true,
    hold_chain_until_sent:    s.hold_chain_until_sent === true,
  };
}

/** フォーム状態 → API 送信用 scheduled_message_settings（未操作なら null で送ってDBを汚さない）。 */
export function formStateToScheduledSettings(s: ScheduledMessageFormState): {
  enabled: boolean; delay_minutes: number; body: string | null; character_id: string | null;
  cancel_on_phase_change: boolean; cancel_on_work_completed: boolean; hold_chain_until_sent: boolean;
} | null {
  const touched = s.enabled || !!s.body.trim() || !!s.character_id || s.cancel_on_phase_change || s.cancel_on_work_completed || s.hold_chain_until_sent;
  if (!touched) return null;
  return {
    enabled:                  s.enabled,
    delay_minutes:            s.delay_minutes,
    body:                     s.body.trim() ? s.body : null,
    character_id:             s.character_id || null,
    cancel_on_phase_change:   s.cancel_on_phase_change,
    cancel_on_work_completed: s.cancel_on_work_completed,
    hold_chain_until_sent:    s.hold_chain_until_sent,
  };
}

// ── QR「返す内容（応答メッセージ）」/ 遷移先メッセージ 選択肢 ───────────────
// 純関数として _form-helpers に置き、候補抽出とラベル生成をテスト可能にする。

/** 選択肢候補メッセージ（QR の応答/遷移先で使う最小フィールド）。 */
export interface OptionCandidateMessage {
  id:            string;
  body:          string | null;
  kind?:         string | null;
  message_type?: string | null;
  phase_id?:     string | null;
}

/**
 * QR「返す内容」/ 遷移先メッセージの選択肢ラベル。
 * 通話リクエストは本文（body）が空で内容が flex_payload_json 側にあるため、
 * 従来の `body ?? "(本文なし)"` だと「(本文なし)」となり選択肢で識別できなかった。
 * 種別名（通話リクエスト）で識別できるようにする。他の種別は従来どおり body を表示する
 * （＝ text / image / video / flex 等の候補表示は変更しない）。
 */
export function messageOptionLabel(m: { message_type?: string | null; body: string | null }): string {
  if (m.message_type === "call_request") {
    const b = (m.body ?? "").trim();
    return b ? `通話リクエスト: ${b}` : "通話リクエスト";
  }
  return m.body ?? "(本文なし)";
}

/**
 * QR Step2「返す内容（応答メッセージ）」の候補を抽出する。
 * 仕様: 種別=応答（kind="response"）のメッセージのみが候補（編集中メッセージ自身は除外）。
 *   - message_type では絞らない（call_request も kind="response" なら候補に含める）。
 *   - kind="normal" の call_request 等は候補外（＝「応答メッセージのみ選択可」仕様の維持）。
 */
export function filterResponseMessageCandidates<T extends OptionCandidateMessage>(
  messages: T[],
  currentMessageId: string | undefined,
): T[] {
  return messages.filter((m) => m.kind === "response" && m.id !== currentMessageId);
}
