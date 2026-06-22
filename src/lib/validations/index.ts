// src/lib/validations/index.ts
// Zod バリデーションスキーマ

import { z } from "zod";
import { normalizeFlexJson, FLEX_ERRORS } from "@/lib/flex";

// ────────────────────────────────────────────────
// 共通プリミティブ
// ────────────────────────────────────────────────
const uuidSchema  = z.string().uuid({ message: "有効なUUIDを指定してください" });
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{3,8}$/, "カラーコードは #RGB または #RRGGBB 形式で入力してください").optional();
const urlSchema   = z.string().url({ message: "有効なURLを入力してください" }).optional();
const sortSchema  = z.number().int().min(0).default(0);
/** 変数名バリデータ — 自由入力受付の保存先変数名やテンプレ差し込み変数で使う。
 *  形式: ^[a-zA-Z_][a-zA-Z0-9_]*$ (半角英数字 + アンダースコア、先頭は英字 or `_`)。 */
export const VARIABLE_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const variableKeySchema = z.string()
  .min(1, "変数名は必須です")
  .max(60, "変数名は 60 文字以内で入力してください")
  .regex(
    VARIABLE_KEY_REGEX,
    "変数名は半角英数字とアンダースコアで入力してください。先頭に数字は使えません。",
  );

// ────────────────────────────────────────────────
// OA
// ────────────────────────────────────────────────
export const createOaSchema = z.object({
  title:                z.string().min(1, "作品名は必須です").max(100, "作品名は100文字以内で入力してください"),
  description:          z.string().max(500).optional(),
  channel_id:           z.string().min(1, "Channel IDは必須です"),
  // LINE OA Basic ID（例: 613zlngs）。Webhook URL の [oaId] 部分として使う。@ は含まない。
  line_oa_id:           z.string().max(50).optional(),
  channel_secret:       z.string().min(1, "Channel Secretは必須です"),
  channel_access_token: z.string().min(1, "Access Tokenは必須です"),
  publish_status:       z.enum(["draft", "active", "paused"]).default("draft"),
});

export const updateOaSchema = createOaSchema.partial().omit({ publish_status: true }).extend({
  publish_status: z.enum(["draft", "active", "paused"]).optional(),
  line_oa_id:     z.string().max(50).optional().nullable(),
  spreadsheet_id: z.string().min(20).max(100).optional().nullable(),
  /**
   * サービス稼働状態のトグル。true → 停止中 (serviceSuspendedAt = now) / false → 稼働中 (null)。
   * undefined (= 省略) なら変更なし。
   * publish_status とは独立。契約終了等で LINE webhook を通常応答させず、
   * 一律「サービス終了」メッセージのみ返す状態に切り替える。
   */
  service_suspended: z.boolean().optional(),
  /** 利用区分（個人/法人）。owner のみ編集可（PATCH /api/oas/[id] は owner gate）。 */
  usage_type: z.enum(["personal", "business"]).optional(),
});

/**
 * OA の LIFF 設定更新スキーマ（PATCH /api/oas/:id/liff-settings）。
 * - liff_id: LIFF アプリ ID（例: "1234567890-abcdEFGH"）。空文字 / null は「クリア」扱い。
 * - liff_endpoint_url: 表示用メモ（任意・挙動には影響しない）。
 * - liff_scan_qr_enabled: QR 読み取り導線を使う想定かの UI フラグ。
 */
export const updateOaLiffSettingsSchema = z.object({
  liff_id:              z.string().trim().max(200).optional().nullable(),
  liff_endpoint_url:    z.string().trim().max(500).optional().nullable(),
  liff_scan_qr_enabled: z.boolean().optional(),
});

export const oaQuerySchema = z.object({
  publish_status: z.enum(["draft", "active", "paused"]).optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(20),
});

// ────────────────────────────────────────────────
// Work
// ────────────────────────────────────────────────
export const createWorkSchema = z.object({
  oa_id:          uuidSchema,
  title:          z.string().min(1, "作品名は必須です").max(100, "作品名は100文字以内で入力してください"),
  description:    z.string().max(500).optional(),
  publish_status: z.enum(["draft", "active", "paused"]).default("draft"),
  sort_order:     sortSchema,
});

export const updateWorkSchema = z.object({
  title:               z.string().min(1).max(100).optional(),
  description:         z.string().max(500).optional().nullable(),
  publish_status:      z.enum(["draft", "active", "paused"]).optional(),
  sort_order:          z.number().int().min(0).optional(),
  /** LIFF プレイヤー機能 (作品メニュー + 個別 LIFF ページ) の有効/無効。 */
  liff_enabled:        z.boolean().optional(),
  /** 作品メニューホームの任意設定（title/description/image_url）。指定キーのみ更新・空文字は解除。 */
  liff_home_settings:  z.object({
    title:        z.string().max(40).optional().nullable(),
    description:  z.string().max(2000).optional().nullable(),
    image_url:    z.string().max(2000).optional().nullable(),
    header_title: z.string().max(40).optional().nullable(),
    // ホーム（作品単位）フォント。"default" は解除（= 従来フォント）扱い。
    font_family:  z.enum(["default", "meiryo", "hiragino", "yu_gothic", "ud"]).optional().nullable(),
    // ホームメニュー表示モード。"card"/null/未指定 は既定(カード)に解除。
    home_menu_layout: z.enum(["card", "list"]).optional().nullable(),
  }).optional(),
  /** 途中再開機能の有効/無効（作品単位）。true=再開選択肢を表示 / false=最初から開始に寄せる。 */
  resume_enabled:      z.boolean().optional(),
  system_character_id: z.string().uuid().optional().nullable(),
  /**
   * あいさつメッセージ。最大 1000 文字。
   * null を送ると削除、undefined（省略）は変更なし。
   */
  welcome_message:     z.string().max(1000).optional().nullable(),
  /** 友だち追加時の動作。"auto_start" | "welcome_wait" | "none"。 */
  follow_action:       z.enum(["auto_start", "welcome_wait", "none"]).optional(),
  // ── 演出デフォルト設定 ──
  read_receipt_mode:    z.enum(["inherit", "immediate", "delayed", "before_reply"]).optional().nullable(),
  read_delay_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_enabled:       z.boolean().optional().nullable(),
  typing_min_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_max_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  loading_enabled:      z.boolean().optional().nullable(),
  loading_threshold_ms: z.number().int().min(0).max(30000).optional().nullable(),
  loading_min_seconds:  z.number().int().min(3).max(60).optional().nullable(),
  loading_max_seconds:  z.number().int().min(3).max(60).optional().nullable(),
}).superRefine((val, ctx) => {
  if (val.typing_min_ms != null && val.typing_max_ms != null && val.typing_min_ms > val.typing_max_ms) {
    ctx.addIssue({ code: "custom", path: ["typing_max_ms"], message: "typing_max_ms は typing_min_ms 以上にしてください" });
  }
  if (val.loading_min_seconds != null && val.loading_max_seconds != null && val.loading_min_seconds > val.loading_max_seconds) {
    ctx.addIssue({ code: "custom", path: ["loading_max_seconds"], message: "loading_max_seconds は loading_min_seconds 以上にしてください" });
  }
});

export const workQuerySchema = z.object({
  oa_id:          uuidSchema,
  publish_status: z.enum(["draft", "active", "paused"]).optional(),
});

// ────────────────────────────────────────────────
// Character
//
// テキストアイコン型（icon_type: "text"）は廃止。
//   - 新規作成: icon_type は "image" 固定
//   - 更新: icon_type を "text" に変更することは不可
//   - 既存データ: DB の "text" 行はそのまま読み取り可能（後方互換）
// ────────────────────────────────────────────────

export const createCharacterSchema = z.object({
  work_id:        uuidSchema,
  name:           z.string().min(1, "キャラクター名は必須です").max(50),
  /** キャラクター紹介文（任意・最大 500 字）。trim 後、空 / 省略は API 層で null 化。 */
  description:    z.string().trim().max(500, "説明文は500文字以内で入力してください").nullish(),
  /** 新規作成は "image" 固定。省略しても "image" になる */
  icon_type:      z.literal("image").default("image"),
  icon_image_url: urlSchema,
  sort_order:     sortSchema,
  is_active:      z.boolean().default(true),
}).superRefine((val, ctx) => {
  if (!val.icon_image_url) {
    ctx.addIssue({ code: "custom", path: ["icon_image_url"], message: "アイコン画像 URL は必須です" });
  }
});

/**
 * PATCH 用スキーマ。
 *   - icon_type は "image" のみ許可（"text" への変更は拒否）
 *   - icon_text / icon_color は null への変更のみ許可（既存データのクリア用）
 */
export const updateCharacterSchema = z.object({
  name:           z.string().min(1).max(50).optional(),
  /** キャラクター紹介文（任意・最大 500 字）。省略＝変更なし / null・空＝API 層で null 化。 */
  description:    z.string().trim().max(500, "説明文は500文字以内で入力してください").nullish(),
  /** 更新時も "image" のみ。"text" への変更は拒否 */
  icon_type:      z.literal("image").optional(),
  /** テキストアイコン廃止。null（クリア）のみ受け付ける */
  icon_text:      z.null().optional(),
  icon_image_url: z.string().url().optional().nullable(),
  /** テキストアイコン廃止。null（クリア）のみ受け付ける */
  icon_color:     z.null().optional(),
  sort_order:     z.number().int().min(0).optional(),
  is_active:      z.boolean().optional(),
}).superRefine((val, ctx) => {
  if (val.icon_image_url === null) {
    ctx.addIssue({ code: "custom", path: ["icon_image_url"], message: "icon_image_url を null にはできません（画像URL型キャラクターは URL 必須）" });
  }
});

export const characterQuerySchema = z.object({
  work_id:   uuidSchema,
  is_active: z.coerce.boolean().optional(),
});

// ────────────────────────────────────────────────
// Phase
// ────────────────────────────────────────────────
export const createPhaseSchema = z.object({
  work_id:        uuidSchema,
  phase_type:     z.enum(["start", "normal", "ending", "global"]).default("normal"),
  name:           z.string().min(1, "フェーズ名は必須です").max(100),
  description:    z.string().max(500).optional(),
  /** 開始トリガーキーワード（phaseType="start" のみ有効） */
  start_trigger:  z.string().max(200).optional().nullable(),
  /**
   * 再開時あらすじ（任意）。
   * 途中離脱ユーザーが「途中から再開する」を選んだとき、フェーズ先頭前に送信される。
   */
  resume_summary: z.string().max(500).optional().nullable(),
  sort_order:     sortSchema,
  is_active:      z.boolean().default(true),
});

export const updatePhaseSchema = z.object({
  phase_type:     z.enum(["start", "normal", "ending", "global"]).optional(),
  name:           z.string().min(1).max(100).optional(),
  description:    z.string().max(500).optional().nullable(),
  /** 開始トリガーキーワード（null で削除） */
  start_trigger:  z.string().max(200).optional().nullable(),
  /**
   * 再開時あらすじ（null で削除）。
   * 途中離脱ユーザーが「途中から再開する」を選んだとき、フェーズ先頭前に送信される。
   */
  resume_summary: z.string().max(500).optional().nullable(),
  sort_order:     z.number().int().min(0).optional(),
  is_active:      z.boolean().optional(),
});

export const phaseQuerySchema = z.object({
  work_id:    uuidSchema,
  phase_type: z.enum(["start", "normal", "ending", "global"]).optional(),
  is_active:  z.coerce.boolean().optional(),
});

// ────────────────────────────────────────────────
// Transition
// ────────────────────────────────────────────────
/** set_flags が有効な JSON オブジェクト文字列かを検証する */
const setFlagsSchema = z
  .string()
  .refine((s) => {
    try {
      const v = JSON.parse(s);
      return v !== null && typeof v === "object" && !Array.isArray(v);
    } catch {
      return false;
    }
  }, { message: "set_flags は有効な JSON オブジェクトである必要があります（例: {\"score\": 10}）" })
  .optional();

export const createTransitionSchema = z.object({
  work_id:       uuidSchema,
  from_phase_id: uuidSchema,
  to_phase_id:   uuidSchema,
  label:         z.string().min(1, "選択肢ラベルは必須です").max(200),
  condition:     z.string().max(500).optional(),
  /** フラグ条件式。例: "flags.score >= 10", "flags.has_key == true", "!flags.used" */
  flag_condition: z.string().max(500).optional(),
  /** 遷移実行時フラグ更新 JSON。例: '{"score": 10, "has_key": true}' */
  set_flags:     setFlagsSchema,
  sort_order:    sortSchema,
  is_active:     z.boolean().default(true),
}).superRefine((val, ctx) => {
  if (val.from_phase_id === val.to_phase_id) {
    ctx.addIssue({ code: "custom", path: ["to_phase_id"], message: "遷移元と遷移先に同じフェーズは指定できません" });
  }
});

export const updateTransitionSchema = z.object({
  to_phase_id:    uuidSchema.optional(),
  label:          z.string().min(1).max(200).optional(),
  condition:      z.string().max(500).optional().nullable(),
  flag_condition: z.string().max(500).optional().nullable(),
  set_flags:      setFlagsSchema,
  sort_order:     z.number().int().min(0).optional(),
  is_active:      z.boolean().optional(),
});

export const transitionQuerySchema = z.object({
  work_id:       uuidSchema.optional(),
  from_phase_id: uuidSchema.optional(),
  to_phase_id:   uuidSchema.optional(),
  is_active:     z.coerce.boolean().optional(),
  with_phases:   z.coerce.boolean().default(false),
}).superRefine((val, ctx) => {
  if (!val.work_id && !val.from_phase_id) {
    ctx.addIssue({ code: "custom", path: ["work_id"], message: "work_id または from_phase_id のどちらかは必須です" });
  }
});

// ────────────────────────────────────────────────
// Message — クイックリプライ
// ────────────────────────────────────────────────
/** クイックリプライ 1件のスキーマ（LINE 仕様: max 13件 / label max 20文字） */
export const quickReplyItemSchema = z.object({
  label:             z.string().min(1, "ラベルは1文字以上必要です").max(20, "ラベルは20文字以内にしてください"),
  action:            z.enum(["text", "url", "next", "hint", "custom"]),
  value:             z.string().max(500).optional(),
  /** action="hint" のときにボットが返信するヒント本文 */
  hint_text: z.string().max(600000).optional(),
  /** action="hint" のときにヒント本文の後に続けて送信する回答誘導メッセージ */
  hint_followup:     z.string().max(500).optional(),
  /** false のときは LINE QR に含めない（OFF 状態） */
  enabled:           z.boolean().optional(),
  /**
   * タップ時の遷移先種別（action="text" と組み合わせて使用）。
   * "phase" = 通常のフェーズ遷移 / "message" = 特定メッセージを直接返信
   */
  target_type:       z.enum(["phase", "message"]).optional(),
  /** target_type="message" のとき、返信するメッセージの ID */
  target_message_id: z.string().uuid().optional(),
  /** action="text" のとき、タップ時に遷移するフェーズの ID */
  target_phase_id:   z.string().uuid().optional(),
  /**
   * このボタンをタップしたときのユーザー入力を受け取る応答メッセージの ID。
   * 設定されると、応答メッセージの trigger_keyword にラベルが自動マージされる。
   */
  response_message_id: z.string().uuid().optional(),
});

// ────────────────────────────────────────────────
// Message
// ────────────────────────────────────────────────
/**
 * puzzle answer_match_type 配列スキーマ。
 *   - "exact" / "partial": 照合条件（どちらか必須）
 *   - "normalize_width" / "ignore_punctuation": 正規化オプション（任意）
 *
 * 既存データとの互換性のため、"exact" / "partial" のどちらも含まない場合は
 * "exact" として扱う（パース時に補完）。バリデーションでは少なくとも1要素
 * 必要であることだけを保証する。
 */
const answerMatchTypeSchema = z
  .array(z.enum(["exact", "partial", "ignore_punctuation", "normalize_width"]))
  .min(1, "照合条件を選択してください")
  .refine(
    (arr) => !(arr.includes("exact") && arr.includes("partial")),
    "完全一致と部分一致は同時に指定できません",
  )
  .default(["exact"]);

export const createMessageSchema = z.object({
  work_id:          uuidSchema,
  phase_id:         uuidSchema.optional().nullable(),
  character_id:     uuidSchema.optional().nullable(),
  message_type:     z.enum(["text", "image", "riddle", "video", "carousel", "voice", "flex"]).default("text"),
  /** メッセージ役割種別: "start" | "normal" | "response" | "hint" | "puzzle" | "system_notice" */
  kind:             z.enum(["start", "normal", "response", "hint", "puzzle", "system_notice"]).default("normal"),
  body:             z.string().max(10000).optional(),
  asset_url:        urlSchema,
  trigger_keyword:  z.string().max(200).optional().nullable(),
  target_segment:   z.string().max(100).optional().nullable(),
  notify_text:      z.string().max(500).optional(),
  riddle_id:        uuidSchema.optional().nullable(),
  quick_replies:    z.array(quickReplyItemSchema).max(13, "クイックリプライは最大13件までです").optional().nullable(),
  /** 連続送信チェーン先メッセージ ID（null = チェーンなし） */
  next_message_id:  uuidSchema.optional().nullable(),
  alt_text:         z.string().max(400).optional().nullable(),
  flex_payload_json: z.string().max(50000).optional().nullable(),
  // Puzzle fields
  puzzle_type:           z.enum(["text", "image", "video", "carousel"]).optional().nullable(),
  answer:                z.string().max(500).optional().nullable(),
  answers:               z.array(z.string().max(500)).max(50).optional().nullable(),
  puzzle_hint_text:      z.string().max(1000).optional().nullable(),
  answer_match_type:     answerMatchTypeSchema,
  correct_action:        z.enum(["text", "text_and_transition", "transition"]).optional().nullable(),
  correct_text:          z.string().max(2000).optional().nullable(),
  correct_character_id:    uuidSchema.optional().nullable(),
  incorrect_text:          z.string().max(2000).optional().nullable(),
  incorrect_character_id:  uuidSchema.optional().nullable(),
  incorrect_quick_replies: z.array(quickReplyItemSchema).max(13).optional().nullable(),
  correct_next_phase_id: uuidSchema.optional().nullable(),
  hint_mode: z.enum(["always", "on_wrong", "hidden"]).default("always").optional(),
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = 即時送信 */
  lag_ms:           z.number().int().min(0).default(0),
  // ── 演出設定 ──
  read_receipt_mode:    z.enum(["inherit", "immediate", "delayed", "before_reply"]).optional().nullable(),
  read_delay_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_enabled:       z.boolean().optional().nullable(),
  typing_min_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_max_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  loading_enabled:      z.boolean().optional().nullable(),
  loading_threshold_ms: z.number().int().min(0).max(30000).optional().nullable(),
  loading_min_seconds:  z.number().int().min(3).max(60).optional().nullable(),
  loading_max_seconds:  z.number().int().min(3).max(60).optional().nullable(),
  // ── タップ遷移先 ──
  tap_destination_id: z.string().uuid().optional().nullable(),
  tap_url:            z.string().url("有効なURLを入力してください").max(2000).optional().nullable(),
  // ── 画像タップ時アクション (messageType="image" 用) ──
  // type=null/"none" = アクションなし (= 通常 Image Message)
  // type="message"   = タップでプレイヤーからテキスト送信 (image_action_text 必須)
  // type="uri"       = タップで外部 URL を開く (HTTPS のみ)
  // type="liff"      = タップで LIFF ページを開く
  // type="postback"  = タップで postback (将来拡張)
  image_action_type: z.enum(["none", "message", "uri", "liff", "postback", "message_with_phase"]).optional().nullable(),
  image_action_text: z.string().max(300).optional().nullable(),
  image_action_url: z.string().url("HTTPS の URL を入力してください").max(2000)
    .refine((v) => v.startsWith("https://"), "HTTPS のみ対応 (http:// は使用不可)")
    .optional().nullable(),
  image_action_liff_page_id:   uuidSchema.optional().nullable(),
  image_action_postback_data:  z.string().max(300).optional().nullable(),
  // type="message_with_phase" 用: 送信テキスト受信時に遷移する先フェーズ ID。
  image_action_phase_id:       uuidSchema.optional().nullable(),
  // ── 自由入力受付 ──
  free_input_enabled:         z.boolean().default(false),
  free_input_variable_key:    variableKeySchema.optional().nullable(),
  free_input_next_message_id: uuidSchema.optional().nullable(),
  // ── 送信後の待機トリガー（地点到着で自動進行）──
  // "beacon" は DB/API 上は受け付ける設計（検知側 consume は次PR）。UI は QR/GPS のみ表示。
  checkin_trigger_type:            z.enum(["qr", "gps", "beacon"]).optional().nullable(),
  checkin_trigger_location_id:     uuidSchema.optional().nullable(),
  checkin_trigger_next_message_id: uuidSchema.optional().nullable(),
  checkin_trigger_next_phase_id:   uuidSchema.optional().nullable(),
  sort_order:       sortSchema,
  is_active:        z.boolean().default(true),
}).superRefine((val, ctx) => {
  // 演出設定 min <= max バリデーション
  if (val.typing_min_ms != null && val.typing_max_ms != null && val.typing_min_ms > val.typing_max_ms) {
    ctx.addIssue({ code: "custom", path: ["typing_max_ms"], message: "typing_max_ms は typing_min_ms 以上にしてください" });
  }
  if (val.loading_min_seconds != null && val.loading_max_seconds != null && val.loading_min_seconds > val.loading_max_seconds) {
    ctx.addIssue({ code: "custom", path: ["loading_max_seconds"], message: "loading_max_seconds は loading_min_seconds 以上にしてください" });
  }
  // 自由入力受付: variable_key は任意 (空欄なら入力をどこにも保存しない＝ログ用途)。
  // 値があるときの regex チェックは variableKeySchema 内で実施。
  // 画像タップ時アクション: type に応じた必須項目チェック
  if (val.image_action_type && val.image_action_type !== "none") {
    if (val.message_type !== "image") {
      ctx.addIssue({ code: "custom", path: ["image_action_type"],
        message: "画像タップ時アクションは画像メッセージ (message_type=image) のみ設定できます" });
    }
    if (val.image_action_type === "message" && !val.image_action_text?.trim()) {
      ctx.addIssue({ code: "custom", path: ["image_action_text"],
        message: "メッセージ送信アクションには送信テキストが必須です" });
    }
    if (val.image_action_type === "message_with_phase") {
      if (!val.image_action_text?.trim()) {
        ctx.addIssue({ code: "custom", path: ["image_action_text"],
          message: "メッセージ送信＋フェーズ遷移には送信テキストが必須です" });
      }
      if (!val.image_action_phase_id) {
        ctx.addIssue({ code: "custom", path: ["image_action_phase_id"],
          message: "メッセージ送信＋フェーズ遷移には遷移先フェーズが必須です" });
      }
    }
    if (val.image_action_type === "uri" && !val.image_action_url) {
      ctx.addIssue({ code: "custom", path: ["image_action_url"],
        message: "URL アクションには URL が必須です" });
    }
    if (val.image_action_type === "liff" && !val.image_action_liff_page_id) {
      ctx.addIssue({ code: "custom", path: ["image_action_liff_page_id"],
        message: "LIFF アクションには LIFF ページ ID が必須です" });
    }
    if (val.image_action_type === "postback" && !val.image_action_postback_data?.trim()) {
      ctx.addIssue({ code: "custom", path: ["image_action_postback_data"],
        message: "postback アクションには data が必須です" });
    }
  }
  // 送信後の待機トリガー: 種別を指定したら対象地点は必須。
  if (val.checkin_trigger_type && !val.checkin_trigger_location_id) {
    ctx.addIssue({ code: "custom", path: ["checkin_trigger_location_id"], message: "待機トリガーを使う場合は対象地点を選択してください" });
  }
  if (val.kind === "puzzle") {
    if (!val.answer?.trim()) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: "puzzle の場合、正解（answer）は必須です" });
    }
    if (!val.puzzle_type) {
      ctx.addIssue({ code: "custom", path: ["puzzle_type"], message: "puzzle の場合、出題形式（puzzle_type）は必須です" });
    }
    if (
      (val.correct_action === "transition" || val.correct_action === "text_and_transition") &&
      !val.correct_next_phase_id
    ) {
      ctx.addIssue({ code: "custom", path: ["correct_next_phase_id"], message: "遷移系の correct_action には遷移先フェーズが必須です" });
    }
  } else if (val.kind === "system_notice") {
    // システム通知は本文（表示テキスト）のみ必須。message_type は強制しない。
    if (!val.body?.trim()) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "システム通知には表示テキストが必要です" });
    }
  } else {
    // 通常メッセージのバリデーション
    if (val.message_type === "text" && !val.body) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "text型の場合は本文が必要です" });
    }
    if ((val.message_type === "image" || val.message_type === "video" || val.message_type === "voice") && !val.asset_url) {
      ctx.addIssue({ code: "custom", path: ["asset_url"], message: `${val.message_type}型の場合は asset_url が必要です` });
    }
    if (val.message_type === "riddle" && !val.riddle_id) {
      ctx.addIssue({ code: "custom", path: ["riddle_id"], message: "riddle型の場合は riddle_id が必要です" });
    }
    if (val.message_type === "flex") {
      const norm = normalizeFlexJson(val.flex_payload_json);
      if (!norm.ok) {
        ctx.addIssue({ code: "custom", path: ["flex_payload_json"], message: norm.error });
      }
      if (!val.alt_text?.trim()) {
        ctx.addIssue({ code: "custom", path: ["alt_text"], message: FLEX_ERRORS.emptyAltText });
      }
    }
  }
});

/**
 * PATCH 用スキーマ。
 * リクエスト内での明示的な null 化と message_type 変更の整合性のみ確認。
 * 既存レコードとの整合性は route handler 側で確認する。
 */
export const updateMessageSchema = z.object({
  phase_id:          uuidSchema.optional().nullable(),
  character_id:      uuidSchema.optional().nullable(),
  message_type:      z.enum(["text", "image", "riddle", "video", "carousel", "voice", "flex"]).optional(),
  /** メッセージ役割種別 */
  kind:              z.enum(["start", "normal", "response", "hint", "puzzle", "system_notice"]).optional(),
  body:              z.string().max(10000).optional().nullable(),
  asset_url:         z.string().url().optional().nullable(),
  trigger_keyword:   z.string().max(200).optional().nullable(),
  target_segment:    z.string().max(100).optional().nullable(),
  notify_text:       z.string().max(500).optional().nullable(),
  riddle_id:         uuidSchema.optional().nullable(),
  quick_replies:     z.array(quickReplyItemSchema).max(13, "クイックリプライは最大13件までです").optional().nullable(),
  /** 連続送信チェーン先メッセージ ID（null = チェーンなし） */
  next_message_id:   uuidSchema.optional().nullable(),
  alt_text:          z.string().max(400).optional().nullable(),
  flex_payload_json: z.string().max(50000).optional().nullable(),
  // Puzzle fields
  puzzle_type:           z.enum(["text", "image", "video", "carousel"]).optional().nullable(),
  answer:                z.string().max(500).optional().nullable(),
  answers:               z.array(z.string().max(500)).max(50).optional().nullable(),
  puzzle_hint_text:      z.string().max(1000).optional().nullable(),
  answer_match_type:     z
    .array(z.enum(["exact", "partial", "ignore_punctuation", "normalize_width"]))
    .refine(
      (arr) => !(arr.includes("exact") && arr.includes("partial")),
      "完全一致と部分一致は同時に指定できません",
    )
    .optional(),
  correct_action:        z.enum(["text", "text_and_transition", "transition"]).optional().nullable(),
  correct_text:          z.string().max(2000).optional().nullable(),
  correct_character_id:    uuidSchema.optional().nullable(),
  incorrect_text:          z.string().max(2000).optional().nullable(),
  incorrect_character_id:  uuidSchema.optional().nullable(),
  incorrect_quick_replies: z.array(quickReplyItemSchema).max(13).optional().nullable(),
  correct_next_phase_id: uuidSchema.optional().nullable(),
  hint_mode: z.enum(["always", "on_wrong", "hidden"]).optional(),
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = 即時送信 */
  lag_ms:            z.number().int().min(0).optional(),
  // ── 演出設定 ──
  read_receipt_mode:    z.enum(["inherit", "immediate", "delayed", "before_reply"]).optional().nullable(),
  read_delay_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_enabled:       z.boolean().optional().nullable(),
  typing_min_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  typing_max_ms:        z.number().int().min(0).max(600000).optional().nullable(),
  loading_enabled:      z.boolean().optional().nullable(),
  loading_threshold_ms: z.number().int().min(0).max(30000).optional().nullable(),
  loading_min_seconds:  z.number().int().min(3).max(60).optional().nullable(),
  loading_max_seconds:  z.number().int().min(3).max(60).optional().nullable(),
  // ── タップ遷移先 ──
  tap_destination_id: z.string().uuid().optional().nullable(),
  tap_url:            z.string().url("有効なURLを入力してください").max(2000).optional().nullable(),
  // ── 画像タップ時アクション ──
  image_action_type: z.enum(["none", "message", "uri", "liff", "postback", "message_with_phase"]).optional().nullable(),
  image_action_text: z.string().max(300).optional().nullable(),
  image_action_url:  z.string().url("HTTPS の URL を入力してください").max(2000)
    .refine((v) => v.startsWith("https://"), "HTTPS のみ対応 (http:// は使用不可)")
    .optional().nullable(),
  image_action_liff_page_id:   uuidSchema.optional().nullable(),
  image_action_postback_data:  z.string().max(300).optional().nullable(),
  image_action_phase_id:       uuidSchema.optional().nullable(),
  // ── 自由入力受付 ──
  free_input_enabled:         z.boolean().optional(),
  free_input_variable_key:    variableKeySchema.optional().nullable(),
  free_input_next_message_id: uuidSchema.optional().nullable(),
  // ── 送信後の待機トリガー（地点到着で自動進行）──
  checkin_trigger_type:            z.enum(["qr", "gps", "beacon"]).optional().nullable(),
  checkin_trigger_location_id:     uuidSchema.optional().nullable(),
  checkin_trigger_next_message_id: uuidSchema.optional().nullable(),
  checkin_trigger_next_phase_id:   uuidSchema.optional().nullable(),
  sort_order:        z.number().int().min(0).optional(),
  is_active:         z.boolean().optional(),
}).superRefine((val, ctx) => {
  // 演出設定 min <= max バリデーション
  if (val.typing_min_ms != null && val.typing_max_ms != null && val.typing_min_ms > val.typing_max_ms) {
    ctx.addIssue({ code: "custom", path: ["typing_max_ms"], message: "typing_max_ms は typing_min_ms 以上にしてください" });
  }
  if (val.loading_min_seconds != null && val.loading_max_seconds != null && val.loading_min_seconds > val.loading_max_seconds) {
    ctx.addIssue({ code: "custom", path: ["loading_max_seconds"], message: "loading_max_seconds は loading_min_seconds 以上にしてください" });
  }
  // 自由入力受付: variable_key は任意 (PATCH でも null/未指定を許容)。
  if (val.kind !== "puzzle" && val.kind !== "system_notice") {
    if (val.message_type === "text" && val.body === null) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "text型の場合、body を null にはできません" });
    }
    if ((val.message_type === "image" || val.message_type === "video" || val.message_type === "voice") && val.asset_url === null) {
      ctx.addIssue({ code: "custom", path: ["asset_url"], message: `${val.message_type}型の場合、asset_url を null にはできません` });
    }
    // flex: message_type が flex のとき（= 種別を flex に切り替える PATCH）は contents/altText を検証する。
    // message_type を含まない部分更新では skip される。
    if (val.message_type === "flex") {
      const norm = normalizeFlexJson(val.flex_payload_json);
      if (!norm.ok) {
        ctx.addIssue({ code: "custom", path: ["flex_payload_json"], message: norm.error });
      }
      if (!val.alt_text?.trim()) {
        ctx.addIssue({ code: "custom", path: ["alt_text"], message: FLEX_ERRORS.emptyAltText });
      }
    }
  }
  if (val.kind === "system_notice" && val.body === null) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "システム通知の表示テキスト（body）を null にはできません" });
  }
  if (val.kind === "puzzle") {
    if (
      (val.correct_action === "transition" || val.correct_action === "text_and_transition") &&
      val.correct_next_phase_id === null
    ) {
      ctx.addIssue({ code: "custom", path: ["correct_next_phase_id"], message: "遷移系の correct_action には遷移先フェーズが必須です" });
    }
  }
  // 送信後の待機トリガー: 種別を指定したら対象地点は必須（PATCH では地点を明示的に null 化したケースのみ検証）。
  if (val.checkin_trigger_type && val.checkin_trigger_location_id === null) {
    ctx.addIssue({ code: "custom", path: ["checkin_trigger_location_id"], message: "待機トリガーを使う場合は対象地点を選択してください" });
  }
  // 画像タップ時アクション: type に応じた必須項目チェック (PATCH 時)
  if (val.image_action_type && val.image_action_type !== "none") {
    if (val.image_action_type === "message" && val.image_action_text !== undefined &&
        (!val.image_action_text || !val.image_action_text.trim())) {
      ctx.addIssue({ code: "custom", path: ["image_action_text"],
        message: "メッセージ送信アクションには送信テキストが必須です" });
    }
    if (val.image_action_type === "message_with_phase") {
      if (val.image_action_text !== undefined && (!val.image_action_text || !val.image_action_text.trim())) {
        ctx.addIssue({ code: "custom", path: ["image_action_text"],
          message: "メッセージ送信＋フェーズ遷移には送信テキストが必須です" });
      }
      if (val.image_action_phase_id === null) {
        ctx.addIssue({ code: "custom", path: ["image_action_phase_id"],
          message: "メッセージ送信＋フェーズ遷移には遷移先フェーズが必須です" });
      }
    }
    if (val.image_action_type === "uri" && val.image_action_url === null) {
      ctx.addIssue({ code: "custom", path: ["image_action_url"],
        message: "URL アクションには URL が必須です" });
    }
    if (val.image_action_type === "liff" && val.image_action_liff_page_id === null) {
      ctx.addIssue({ code: "custom", path: ["image_action_liff_page_id"],
        message: "LIFF アクションには LIFF ページ ID が必須です" });
    }
    if (val.image_action_type === "postback" && val.image_action_postback_data === null) {
      ctx.addIssue({ code: "custom", path: ["image_action_postback_data"],
        message: "postback アクションには data が必須です" });
    }
  }
});

export const messageQuerySchema = z.object({
  work_id:        uuidSchema,
  phase_id:       uuidSchema.optional(),
  character_id:   uuidSchema.optional(),
  message_type:   z.enum(["text", "image", "riddle", "video", "carousel", "voice"]).optional(),
  is_active:      z.coerce.boolean().optional(),
  with_relations: z.coerce.boolean().default(false),
});

// ────────────────────────────────────────────────
// Runtime（シナリオ実行）
// ────────────────────────────────────────────────
export const startScenarioSchema = z.object({
  line_user_id: z.string().min(1, "line_user_id は必須です").max(100),
  work_id:      uuidSchema,
  /// true のとき管理者・テスターによる疑似プレイ（UserProgress.isPreview=true で記録）
  is_preview:   z.boolean().optional(),
});

export const advanceScenarioSchema = z.object({
  line_user_id:    z.string().min(1, "line_user_id は必須です").max(100),
  work_id:         uuidSchema,
  label:           z.string().min(1).max(500).optional(),
  transition_id:   uuidSchema.optional(),
  target_phase_id: uuidSchema.optional(),
  is_preview:      z.boolean().optional(),
}).superRefine((val, ctx) => {
  if (!val.label && !val.transition_id && !val.target_phase_id) {
    ctx.addIssue({
      code: "custom",
      path: ["label"],
      message: "label、transition_id、または target_phase_id のどちらかは必須です",
    });
  }
});

export const progressQuerySchema = z.object({
  line_user_id: z.string().min(1).max(100),
  work_id:      uuidSchema,
});

export const resetScenarioSchema = z.object({
  line_user_id: z.string().min(1, "line_user_id は必須です").max(100),
  work_id:      uuidSchema,
});

// ────────────────────────────────────────────────
// RichMenu
// ────────────────────────────────────────────────
export const richMenuAreaSchema = z.object({
  x:            z.number().int().min(0),
  y:            z.number().int().min(0),
  width:        z.number().int().min(1),
  height:       z.number().int().min(1),
  action_type:  z.enum(["message", "postback", "uri"]),
  action_label: z.string().max(20).default(""),
  action_text:  z.string().max(300).optional().nullable(),
  action_data:  z.string().max(300).optional().nullable(),
  action_uri:      z.string().url().optional().nullable(),
  destination_id:  z.string().uuid().optional().nullable(),
  sort_order:      sortSchema,
}).superRefine((val, ctx) => {
  if (val.action_type === "message" && !val.action_text) {
    ctx.addIssue({ code: "custom", path: ["action_text"], message: "message タイプには action_text が必須です" });
  }
  if (val.action_type === "postback" && !val.action_data) {
    ctx.addIssue({ code: "custom", path: ["action_data"], message: "postback タイプには action_data が必須です" });
  }
  if (val.action_type === "uri" && !val.action_uri && !val.destination_id) {
    ctx.addIssue({ code: "custom", path: ["action_uri"], message: "uri タイプには action_uri または遷移先の設定が必須です" });
  }
});

export const createRichMenuSchema = z.object({
  oa_id:         uuidSchema,
  name:          z.string().min(1, "メニュー名は必須です").max(100),
  chat_bar_text: z.string().min(1).max(14).default("メニュー"),
  size:          z.enum(["full", "compact"]).default("compact"),
  image_url:     z.string().url().optional().nullable(),
  is_active:     z.boolean().default(true),
  areas:         z.array(richMenuAreaSchema).min(1).max(20),
});

export const updateRichMenuSchema = z.object({
  name:          z.string().min(1).max(100).optional(),
  chat_bar_text: z.string().min(1).max(14).optional(),
  size:          z.enum(["full", "compact"]).optional(),
  image_url:     z.string().url().optional().nullable(),
  is_active:     z.boolean().optional(),
  areas:         z.array(richMenuAreaSchema).min(1).max(20).optional(),
});

export const richMenuQuerySchema = z.object({
  oa_id: uuidSchema,
});

// ────────────────────────────────────────────────
// FriendAddSettings（友だち追加設定）
// ────────────────────────────────────────────────

// 絶対 URL (https://...) または /から始まる相対パス (/uploads/...) を許可するスキーマ。
// z.string().url() は RFC 3986 絶対 URL のみ受け入れるため、アップロード後の相対パスを
// 別途 refine で許可する必要がある。
const urlOrRelativeSchema = z.string().refine(
  (v) => /^https?:\/\//.test(v) || v.startsWith("/"),
  "有効なURL、または / から始まるパスを入力してください"
);

/** PUT /api/oas/:id/friend-add — upsert */
export const putFriendAddSchema = z.object({
  campaign_name:   z.string().max(100).optional().nullable(),
  add_url:         z.string().url("有効なURLを入力してください"),
  qr_code_url:     urlOrRelativeSchema.optional().nullable(),
  share_image_url: urlOrRelativeSchema.optional().nullable(),
});

// ────────────────────────────────────────────────
// SnsPost（SNS 投稿管理）
// ────────────────────────────────────────────────

const snsPlatformSchema = z.enum(["x", "instagram", "line", "other"]);

export const createSnsPostSchema = z.object({
  platform:   snsPlatformSchema,
  text:       z.string().min(1, "テキストは必須です").max(5000),
  image_url:  z.string().url().optional().nullable(),
  target_url: z.string().url().optional().nullable(),
  order:      sortSchema,
});

export const updateSnsPostSchema = z.object({
  platform:   snsPlatformSchema.optional(),
  text:       z.string().min(1).max(5000).optional(),
  image_url:  z.string().url().optional().nullable(),
  target_url: z.string().url().optional().nullable(),
  order:      z.number().int().min(0).optional(),
});

// ────────────────────────────────────────────────
// Riddle（謎管理）
// ────────────────────────────────────────────────

const carouselCardSchema = z.object({
  title:       z.string().min(1, "カードタイトルは必須です").max(100),
  description: z.string().max(500).default(""),
  image_url:   z.string().default(""),
});

const hintQuickReplySchema = z.object({
  label:        z.string().min(1, "ラベルは必須です").max(20),
  action_type:  z.enum(["next_hint", "repeat_hint", "cancel_hint", "custom"]),
  action_value: z.string().max(200).default(""),
});

const hintSchema = z.object({
  step:          z.number().int().min(1).max(20),
  text:          z.string().min(1, "ヒントテキストは必須です").max(1000),
  character_id:  z.string().uuid().optional().nullable(),
  quick_replies: z.array(hintQuickReplySchema).max(10).default([]),
});

export const createRiddleSchema = z.object({
  title:               z.string().min(1, "タイトルは必須です").max(100),
  question_type:       z.enum(["text", "image", "video", "carousel"]).default("text"),
  question_text:       z.string().min(1).max(5000).optional().nullable(),
  question_image_url:  urlOrRelativeSchema.optional().nullable(),
  question_video_url:  z.string().url("有効なURLを入力してください").optional().nullable(),
  question_carousel:   z.array(carouselCardSchema).min(1).max(20).optional().nullable(),
  answer_text:         z.string().min(1, "正解テキストは必須です").max(200),
  match_condition:     z.enum(["exact", "partial", "case_insensitive", "normalize_width", "normalize_kana"]).default("exact"),
  correct_message:     z.string().min(1, "正解時メッセージは必須です").max(1000),
  wrong_message:       z.string().min(1, "不正解時メッセージは必須です").max(1000),
  status:              z.enum(["draft", "published"]).default("draft"),
  hints:               z.array(hintSchema).max(20).default([]),
  character_id:        z.string().uuid().optional().nullable(),
  target_segment:      z.string().max(100).optional().nullable(),
  /// 作品スコープ管理用（省略可。null = OA スコープのまま）
  work_id:             z.string().uuid().optional().nullable(),
}).superRefine((val, ctx) => {
  if (val.question_type === "text" && !val.question_text) {
    ctx.addIssue({ code: "custom", path: ["question_text"], message: "テキスト形式の場合、問題文は必須です" });
  }
  if (val.question_type === "image" && !val.question_image_url) {
    ctx.addIssue({ code: "custom", path: ["question_image_url"], message: "画像形式の場合、画像URLは必須です" });
  }
  if (val.question_type === "video" && !val.question_video_url) {
    ctx.addIssue({ code: "custom", path: ["question_video_url"], message: "動画形式の場合、動画URLは必須です" });
  }
  if (val.question_type === "carousel" && (!val.question_carousel || val.question_carousel.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["question_carousel"], message: "カルーセル形式の場合、カードは1枚以上必要です" });
  }
});

// superRefine を持つスキーマには .partial() が使えないため独立定義
export const updateRiddleSchema = z.object({
  title:               z.string().min(1).max(100).optional(),
  question_type:       z.enum(["text", "image", "video", "carousel"]).optional(),
  question_text:       z.string().min(1).max(5000).optional().nullable(),
  question_image_url:  urlOrRelativeSchema.optional().nullable(),
  question_video_url:  z.string().url().optional().nullable(),
  question_carousel:   z.array(carouselCardSchema).min(1).max(20).optional().nullable(),
  answer_text:         z.string().min(1).max(200).optional(),
  match_condition:     z.enum(["exact", "partial", "case_insensitive", "normalize_width", "normalize_kana"]).optional(),
  correct_message:     z.string().min(1).max(1000).optional(),
  wrong_message:       z.string().min(1).max(1000).optional(),
  status:              z.enum(["draft", "published"]).optional(),
  hints:               z.array(hintSchema).max(20).optional(),
  character_id:        z.string().uuid().optional().nullable(),
  target_segment:      z.string().max(100).optional().nullable(),
  work_id:             z.string().uuid().optional().nullable(),
});

export const createHintLogSchema = z.object({
  oa_id:        z.string().uuid(),
  work_id:      z.string().uuid(),
  phase_id:     z.string().uuid().optional().nullable(),
  riddle_id:    z.string().uuid(),
  line_user_id: z.string().min(1).max(100),
  hint_step:    z.number().int().min(1).max(20),
  event_type:   z.enum(["hint_shown", "quick_reply_tapped"]),
  action_type:  z.string().max(50).optional().nullable(),
  action_value: z.string().max(200).optional().nullable(),
});

// ────────────────────────────────────────────────
// Segment
// ────────────────────────────────────────────────
export const createSegmentSchema = z.object({
  oa_id:       uuidSchema,
  name:        z.string().min(1, "セグメント名は必須です").max(100),
  filter_type: z.enum(["phase", "friend_7d", "inactive_7d"]),
  phase_id:    uuidSchema.optional().nullable(),
  status:      z.enum(["active", "inactive"]).default("active"),
}).superRefine((val, ctx) => {
  if (val.filter_type === "phase" && !val.phase_id) {
    ctx.addIssue({ code: "custom", path: ["phase_id"], message: "フェーズを選択してください" });
  }
});

export const updateSegmentSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  filter_type: z.enum(["phase", "friend_7d", "inactive_7d"]).optional(),
  phase_id:    uuidSchema.optional().nullable(),
  status:      z.enum(["active", "inactive"]).optional(),
});

export const segmentQuerySchema = z.object({
  oa_id: uuidSchema,
});

// ────────────────────────────────────────────────
// Tracking
// ────────────────────────────────────────────────
export const createTrackingSchema = z.object({
  oa_id:       uuidSchema,
  name:        z.string().min(1, "トラッキング名は必須です").max(100),
  tracking_id: z.string().min(1).max(64).optional(),
  target_url:  z.string().url("有効なURLを入力してください"),
  utm_enabled: z.boolean().default(true),
});

export const updateTrackingSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  tracking_id: z.string().min(1).max(64).optional(),
  target_url:  z.string().url("有効なURLを入力してください").optional(),
  utm_enabled: z.boolean().optional(),
});

export const trackingQuerySchema = z.object({
  oa_id: uuidSchema,
});

// ────────────────────────────────────────────────
// GlobalCommand スキーマ
// ────────────────────────────────────────────────

const globalCommandActionTypeSchema = z.enum(["HINT", "RESET", "HELP", "REPEAT", "CUSTOM"]);

export const createGlobalCommandSchema = z.object({
  oa_id:       uuidSchema,
  keyword:     z.string().min(1, "キーワードを入力してください").max(100),
  action_type: globalCommandActionTypeSchema,
  payload:     z.string().max(2000).nullable().optional(),
  is_active:   z.boolean().default(true),
  sort_order:  z.number().int().min(0).default(0),
}).superRefine((data, ctx) => {
  if (data.action_type === "CUSTOM" && !data.payload?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload"],
      message: "CUSTOM アクションにはメッセージテキスト（payload）が必要です",
    });
  }
});

export const updateGlobalCommandSchema = z.object({
  keyword:     z.string().min(1).max(100).optional(),
  action_type: globalCommandActionTypeSchema.optional(),
  payload:     z.string().max(2000).nullable().optional(),
  is_active:   z.boolean().optional(),
  sort_order:  z.number().int().min(0).optional(),
});

export const globalCommandQuerySchema = z.object({
  oa_id: uuidSchema,
});

// ── AdminAnnouncement ─────────────────────────────────────────────────────
export const createAnnouncementSchema = z.object({
  type:      z.enum(["update", "bugfix", "known_issue", "info"]).default("info"),
  title:     z.string().min(1).max(200),
  body:      z.string().min(1).max(5000),
  important: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  publish:   z.boolean().default(false),
});

export const updateAnnouncementSchema = z.object({
  type:      z.enum(["update", "bugfix", "known_issue", "info"]).optional(),
  title:     z.string().min(1).max(200).optional(),
  body:      z.string().min(1).max(5000).optional(),
  important: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  publish:   z.boolean().optional(),
});

// ────────────────────────────────────────────────
// LIFF ページ設定
// ────────────────────────────────────────────────

export const LIFF_BLOCK_TYPES = [
  "free_text", "start_button", "resume_button", "progress",
  "evidence_list", "hint_list", "character_list", "image", "video",
  // ── ヒントサイト用 ──
  "heading", "text", "warning", "button_link", "divider", "accordion",
  // ── ロケーションチェックイン用 ──
  "code_reader",
  // ── 謎・問題（到達済みの問題一覧） ──
  "riddle_list",
  // ── チェックイン履歴（プレイヤー本人の訪問履歴） ──
  "checkin_history",
] as const;

export const VISIBILITY_CONDITIONS = [
  "always", "before_start", "in_progress", "completed",
] as const;

// LIFF ページ種別。
// 新しいモード: default / hint / faq / survey / location / character / werewolf
// 旧データ互換: "hint_site" も受理（保存時に "hint" に正規化される）
export const LIFF_PAGE_TYPES = ["default", "hint", "faq", "survey", "location", "character", "werewolf", "contact", "puzzle", "hint_site"] as const;
/** 受け取った page_type を正規化（"hint_site" → "hint"） */
export function normalizeLiffPageTypeValue(value: string | null | undefined): string {
  if (value === "hint_site") return "hint";
  return value ?? "default";
}
export const LIFF_PUBLISH_STATUSES = ["draft", "published", "archived"] as const;
export const LIFF_SECTION_VARIANTS = ["default", "dark", "purple"] as const;
export const LIFF_IMAGE_SIZES = ["normal", "wide", "full"] as const;

/** accordion ネスト最大深度（最上位 accordion を 1 と数える） */
export const LIFF_MAX_ACCORDION_DEPTH = 3;

const liffBlockTypeSchema = z.enum(LIFF_BLOCK_TYPES);
const visibilityConditionSchema = z.enum(VISIBILITY_CONDITIONS).nullable().optional();
const sectionVariantSchema = z.enum(LIFF_SECTION_VARIANTS).optional();

const freeTextSettingsSchema = z.object({
  body:     z.string().max(5000).optional(),
  align:    z.enum(["left", "center"]).optional(),
  emphasis: z.enum(["normal", "strong"]).optional(),
  // PR-BLK4e: 表示スタイル（additive・任意）。未設定は "body" 扱い（renderer 側）。
  variant:  z.enum(["body", "sub"]).optional(),
}).passthrough();

// ブロック用ボタンデザイン。空文字 = 未設定（既定 variant 維持）。既知 variant のみ許可。
// 値集合は primitives/LiffButton の LIFF_BUTTON_VARIANTS と揃える（真実源）。
const buttonVariantSchema = z
  .union([z.literal(""), z.enum(["primary", "outline", "ghost", "dark", "danger"])])
  .optional();

const startButtonSettingsSchema = z.object({
  label:           z.string().max(100).optional(),
  confirm_message: z.string().max(500).optional(),
  api_action:      z.string().max(200).optional(),
  button_variant:  buttonVariantSchema,
}).passthrough();

const resumeButtonSettingsSchema = z.object({
  label: z.string().max(100).optional(),
  button_variant: buttonVariantSchema,
}).passthrough();

const progressSettingsSchema = z.object({
  display_format:   z.enum(["bar", "text"]).optional(),
  show_denominator: z.boolean().optional(),
}).passthrough();

const evidenceListSettingsSchema = z.object({
  max_display_count: z.number().int().min(1).max(100).optional(),
  hide_undiscovered: z.boolean().optional(),
  empty_message:     z.string().max(200).optional(),
}).passthrough();

const hintListSettingsSchema = z.object({
  max_display_count: z.number().int().min(1).max(100).optional(),
  empty_message:     z.string().max(200).optional(),
}).passthrough();

const characterListSettingsSchema = z.object({
  show_icon:        z.boolean().optional(),
  show_description: z.boolean().optional(),
}).passthrough();

// 画像 / 動画 ブロック設定。
// URL は未入力 (= 新規追加直後) を許容するため、空文字も accept する。
// `.url()` 単体だと "" が "Invalid URL" で reject されるため、`.or(z.literal(""))` を併用。
// 既存パターン (header_logo_url 等) と同じ。
const imageSettingsSchema = z.object({
  image_url: z.string().url().optional().or(z.literal("")),
  alt:       z.string().max(200).optional(),
  caption:   z.string().max(500).optional(),
  size:      z.enum(LIFF_IMAGE_SIZES).optional(),
  // PR-BLK4b: 表示枠の比率（additive・任意・size とは別軸）。未設定は "original" 扱い（renderer 側）。
  aspect_ratio: z.enum(["original", "1:1", "4:3", "16:9"]).optional(),
}).passthrough();

const videoSettingsSchema = z.object({
  video_url:  z.string().url().optional().or(z.literal("")),
  poster_url: z.string().url().optional().or(z.literal("")),
  caption:    z.string().max(500).optional(),
}).passthrough();

// ── ヒントサイト用ブロック設定 ─────────────────
// 文字ウェイトの 3 段階。renderer 側で normal=400 / medium=600 / bold=700 にマッピング。
const fontWeightSchema = z.enum(["normal", "medium", "bold"]).optional();

const headingSettingsSchema = z.object({
  text:        z.string().max(300).optional(),
  // 旧 1|2|3 から 1〜5 に拡張。既存データ (level 1-3) は引き続き有効。
  level:       z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  align:       z.enum(["left", "center"]).optional(),
  font_weight: fontWeightSchema,
}).passthrough();

const textSettingsSchema = z.object({
  body:        z.string().max(5000).optional(),
  align:       z.enum(["left", "center"]).optional(),
  emphasis:    z.enum(["normal", "strong"]).optional(),
  font_weight: fontWeightSchema,
}).passthrough();

const warningSettingsSchema = z.object({
  body: z.string().max(500).optional(),
  tone: z.enum(["spoiler", "info", "danger"]).optional(),
  // PR-BLK4a: 左アイコン（additive・任意）。未設定は "auto" 扱い（renderer 側）。
  icon: z.enum(["auto", "none", "warning", "info", "alert"]).optional(),
}).passthrough();

const buttonLinkSettingsSchema = z.object({
  label:         z.string().max(100).optional(),
  // 空文字（未設定）も許可する。ボタン追加直後の既定は url:"" であり、
  // z.string().url() だけだと "" が present かつ invalid 扱いで作成/保存が 400 になるため。
  // 非空のときのみ URL 形式を検証する。
  url:           z.union([z.literal(""), z.string().url()]).optional(),
  open_external: z.boolean().optional(),
  variant:       sectionVariantSchema,
  button_variant: buttonVariantSchema,
  // 遷移先タイプ。未指定は external 互換。liff_page/location は選択時に url を実URLへ解決して保存する。
  link_type:     z.enum(["external", "liff_page", "location"]).optional(),
  liff_page_id:  z.string().optional(),
  location_id:   z.string().optional(),
}).passthrough();

const dividerSettingsSchema = z.object({
  // PR-BLK4c: style enum を additive 拡張・label（任意）を追加。.passthrough() 維持。
  style: z.enum(["solid", "dashed", "dotted", "thick", "label"]).optional(),
  label: z.string().max(40).optional(),
}).passthrough();

const riddleListSettingsSchema = z.object({
  title:          z.string().max(100).optional(),
  max_count:      z.number().int().min(1).max(100).optional(),
  show_status:    z.boolean().optional(),
  // PR-PZ2.1: 謎・問題ページ/ブロックの表示設定（spoiler-safe な見た目/範囲のみ）。
  heading_mode:   z.enum(["riddle", "question", "custom"]).optional(),
  heading_custom: z.string().max(20).optional(),
  show_heading:   z.boolean().optional(),
  display_mode:   z.enum(["all", "delivered", "solved"]).optional(),
}).passthrough();

const nestedBlockBaseSchema = z.object({
  id:            z.string().optional(),
  block_type:    liffBlockTypeSchema,
  title:         z.string().max(200).optional().nullable(),
  settings_json: z.record(z.unknown()).optional(),
});

const accordionSettingsSchema: z.ZodTypeAny = z.object({
  title:        z.string().max(300).optional(),
  default_open: z.boolean().optional(),
  variant:      sectionVariantSchema,
  children:     z.array(nestedBlockBaseSchema).optional(),
  // PR-BLK4d: 複数項目（multi）。additive・任意。各 item は title/body のみ。.passthrough() 維持。
  items:        z.array(z.object({
    title: z.string().max(120).optional(),
    body:  z.string().max(1000).optional(),
  }).passthrough()).max(20).optional(),
}).passthrough();

const codeReaderSettingsSchema = z.object({
  label:       z.string().max(100).optional(),
  modal_title: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  after_scan:  z.enum(["location_checkin", "show_result"]).optional(),
}).passthrough();

const checkinHistorySettingsSchema = z.object({
  title:       z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  max_count:   z.number().int().min(1).max(100).optional(),
}).passthrough();

const SETTINGS_SCHEMA_MAP: Record<string, z.ZodTypeAny> = {
  free_text:       freeTextSettingsSchema,
  start_button:    startButtonSettingsSchema,
  resume_button:   resumeButtonSettingsSchema,
  progress:        progressSettingsSchema,
  evidence_list:   evidenceListSettingsSchema,
  hint_list:       hintListSettingsSchema,
  character_list:  characterListSettingsSchema,
  image:           imageSettingsSchema,
  video:           videoSettingsSchema,
  // ── ヒントサイト用 ──
  heading:         headingSettingsSchema,
  text:            textSettingsSchema,
  warning:         warningSettingsSchema,
  button_link:     buttonLinkSettingsSchema,
  divider:         dividerSettingsSchema,
  accordion:       accordionSettingsSchema,
  code_reader:     codeReaderSettingsSchema,
  riddle_list:     riddleListSettingsSchema,
  checkin_history: checkinHistorySettingsSchema,
};

/**
 * accordion 内 children を再帰的に検証する。
 */
function validateNestedChildren(
  children: unknown,
  depth: number,
  pathPrefix: (string | number)[],
  issues: z.ZodIssue[],
): void {
  if (children === undefined || children === null) return;
  if (!Array.isArray(children)) {
    issues.push({ code: "custom", path: pathPrefix, message: "children は配列で指定してください" });
    return;
  }
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as { block_type?: unknown; settings_json?: unknown };
    const childPath = [...pathPrefix, i];

    if (typeof child !== "object" || child === null) {
      issues.push({ code: "custom", path: childPath, message: "child の形式が不正です" });
      continue;
    }
    const blockType = child.block_type;
    if (typeof blockType !== "string") {
      issues.push({ code: "custom", path: [...childPath, "block_type"], message: "block_type が不正です" });
      continue;
    }
    const schema = SETTINGS_SCHEMA_MAP[blockType];
    if (!schema) {
      issues.push({ code: "custom", path: [...childPath, "block_type"], message: `不明なブロックタイプ: ${blockType}` });
      continue;
    }

    const settings = child.settings_json ?? {};
    const r = schema.safeParse(settings);
    if (!r.success) {
      for (const issue of r.error.issues) {
        issues.push({
          ...issue,
          path: [...childPath, "settings_json", ...issue.path],
        });
      }
    }

    if (blockType === "accordion") {
      const nextDepth = depth + 1;
      if (nextDepth > LIFF_MAX_ACCORDION_DEPTH) {
        issues.push({
          code: "custom",
          path: [...childPath],
          message: `accordion は最大 ${LIFF_MAX_ACCORDION_DEPTH} 階層までしかネストできません`,
        });
        continue;
      }
      const innerSettings = (settings ?? {}) as { children?: unknown };
      validateNestedChildren(
        innerSettings.children,
        nextDepth,
        [...childPath, "settings_json", "children"],
        issues,
      );
    }
  }
}

export function validateBlockSettings(blockType: string, settings: unknown): z.SafeParseReturnType<unknown, unknown> {
  const schema = SETTINGS_SCHEMA_MAP[blockType];
  if (!schema) return { success: false, error: new z.ZodError([{ code: "custom", message: `不明なブロックタイプ: ${blockType}`, path: ["block_type"] }]) } as z.SafeParseError<unknown>;
  const base = schema.safeParse(settings);
  if (!base.success) return base;

  if (blockType === "accordion") {
    const issues: z.ZodIssue[] = [];
    const s = (settings ?? {}) as { children?: unknown };
    validateNestedChildren(s.children, 1, ["children"], issues);
    if (issues.length > 0) {
      return { success: false, error: new z.ZodError(issues) } as z.SafeParseError<unknown>;
    }
  }
  return base;
}

// ── FAQ / Survey 設定 ────────────────────────
const faqItemSchema = z.object({
  id:       z.string().optional(),
  question: z.string().max(300),
  answer:   z.string().max(3000),
});

const surveyInputTypeSchema = z.enum(["text", "textarea", "radio", "checkbox"]);

const surveyItemSchema = z.object({
  id:         z.string().optional(),
  question:   z.string().max(300),
  input_type: surveyInputTypeSchema,
  options:    z.array(z.string().max(200)).max(20).optional(),
  required:   z.boolean().optional(),
});

// ── LIFF ページ設定スキーマ（ヒントサイト用 + FAQ / Survey フィールドを含む） ──
export const liffPageConfigSettingsSchema = z.object({
  // フォントプリセット (新)。未指定 / 不正値は renderer 側で "line_seed_jp" 扱い。
  font_preset:          z.enum(["line_seed_jp", "system_sans", "noto_sans_jp", "serif"]).optional(),
  // 旧フォントファミリ (deprecated)。データ互換のため残置。新規 CMS では出さない。
  font_family:          z.enum(["gothic", "mincho"]).optional(),
  // ヘッダーに表示する文言 (新)。例: "チェックイン" / "設定資料"
  header_title:         z.string().max(30).optional(),
  // 本文 description の配置。未指定 / 不正値は renderer 側で "center" 扱い。
  description_align:    z.enum(["left", "center", "right"]).optional(),
  header_fixed:         z.boolean().optional(),
  header_logo_url:      z.string().url().optional().or(z.literal("")),
  header_logo_alt:      z.string().max(200).optional(),
  header_cta_label:     z.string().max(100).optional(),
  header_cta_url:       z.string().url().optional().or(z.literal("")),
  show_hamburger:       z.boolean().optional(),
  spoiler_warning_text: z.string().max(500).optional(),
  theme: z.object({
    header_bg: z.string().max(64).optional(),
    header_fg: z.string().max(64).optional(),
    variants: z.object({
      default: z.object({ bg: z.string().max(64).optional(), fg: z.string().max(64).optional(), border: z.string().max(64).optional() }).partial().optional(),
      dark:    z.object({ bg: z.string().max(64).optional(), fg: z.string().max(64).optional(), border: z.string().max(64).optional() }).partial().optional(),
      purple:  z.object({ bg: z.string().max(64).optional(), fg: z.string().max(64).optional(), border: z.string().max(64).optional() }).partial().optional(),
    }).partial().optional(),
  }).partial().optional(),

  // シェアボタン設定（全モード共通）
  share_enabled:         z.boolean().optional(),
  share_button_label:    z.string().max(100).optional(),
  share_message:         z.string().max(1000).optional(),
  // FAQ モード
  faq_items:             z.array(faqItemSchema).max(100).optional(),
  // Survey モード
  survey_items:          z.array(surveyItemSchema).max(50).optional(),
  survey_thanks_message: z.string().max(500).optional(),

  // ── Contact（お問い合わせ）モード設定。すべて任意。 ──
  contact_categories:        z.array(z.string().max(50)).max(20).optional(),
  contact_category_required: z.boolean().optional(),
  contact_show_name:         z.boolean().optional(),
  contact_name_required:     z.boolean().optional(),
  contact_show_email:        z.boolean().optional(),
  contact_email_required:    z.boolean().optional(),
  contact_body_required:     z.boolean().optional(),
  contact_custom_fields:     z.array(surveyItemSchema).max(50).optional(),
  contact_success_message:   z.string().max(500).optional(),

  // PR #59 のタブ UI 用 (deprecated)。後方互換のため schema には残置、renderer は参照しない。
  tab_enabled:    z.boolean().optional(),
  tab_label:      z.string().max(30).optional(),
  tab_page_title: z.string().max(30).optional(),

  // 作品メニューホーム (グリッドカード) 用 per-page 設定。
  show_in_menu:   z.boolean().optional(),
  menu_label:     z.string().max(30).optional(),
  menu_icon:      z.string().max(8).optional(),
  // メニューアイコン画像 URL。空文字 = 解除（未設定扱い）。非空のときのみ URL 形式を検証する。
  menu_icon_image_url: z.union([z.string().url().max(2000), z.literal("")]).optional(),
  menu_order:     z.number().int().min(0).max(9999).optional(),
  // メニューホームのカード表示形式。未指定は renderer 側で "card" 扱い。
  menu_card_style: z.enum(["card", "compact"]).optional(),

  // LIFF プレイヤー最下部 "Powered by Whale Studio" の表示有無 (ホワイトラベル用)。
  // 未指定 = 表示。
  show_whale_studio_credit: z.boolean().optional(),
}).passthrough();

/** LIFF ページタイトルの最大文字数（10 文字）。
 *  実機ヘッダーで省略表示せず全文を出す前提で、保守的に短く制限する。 */
export const LIFF_PAGE_TITLE_MAX = 10;

export const updateLiffConfigSchema = z.object({
  is_enabled:     z.boolean().optional(),
  title:          z.string().max(LIFF_PAGE_TITLE_MAX).optional().nullable(),
  description:    z.string().max(1000).optional().nullable(),
  // page_type は新旧両方を受理し、保存時に "hint" に正規化する。
  page_type: z.enum(LIFF_PAGE_TYPES).optional().transform((v) => {
    if (v === "hint_site") return "hint" as const;
    return v;
  }),
  publish_status: z.enum(LIFF_PUBLISH_STATUSES).optional(),
  settings_json:  liffPageConfigSettingsSchema.optional(),
});

/** LIFF ページ新規作成。タイトル以外は既定値（API 側で適用）。 */
export const createLiffPageSchema = z.object({
  title:          z.string().max(LIFF_PAGE_TITLE_MAX).optional().nullable(),
  description:    z.string().max(1000).optional().nullable(),
  page_type:      z.enum(LIFF_PAGE_TYPES).optional().transform((v) => {
    if (v === "hint_site") return "hint" as const;
    return v;
  }),
});

// ── 人狼 / 配役閲覧モード ─────────────────────────
// Phase 1: タイトル一覧 + 新規作成 + 削除
// Phase 2: タイトル更新 / slot 更新 / card CRUD / card 並び替え / ゲーム開始

/** 人狼タイトル新規作成 body。POST 時、player_count に応じて WerewolfRoleSlot を auto-generate する。 */
export const createWerewolfTitleSchema = z.object({
  liff_page_config_id: z.string().uuid("LIFF ページ ID が不正です"),
  title:               z.string().min(1, "タイトル名は必須です").max(100, "タイトル名は 100 文字以内で入力してください"),
  description:         z.string().max(1000).optional().nullable(),
  // ISO 文字列を受け取り、Date 形式の妥当性は API 側で `new Date(...)` 後にチェック。
  scheduled_at:        z.string().datetime({ offset: true }).optional().nullable(),
  // MVP では 1 名 〜 50 名を想定。実用上 8〜20 名が中心、上限は念のため広め。
  player_count:        z.number().int().min(1, "プレイヤー人数は 1 以上").max(50, "プレイヤー人数は 50 以下"),
});

/** タイトル更新 body。全フィールド optional (部分更新)。
 *  player_count を増減すると slot を auto extend / 末尾削除する (API 側で処理)。 */
export const updateWerewolfTitleSchema = z.object({
  title:        z.string().min(1).max(100).optional(),
  description:  z.string().max(1000).optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).optional().nullable(),
  player_count: z.number().int().min(1).max(50).optional(),
});

/** スロット更新 body。token は別 endpoint で再発行する。 */
export const updateWerewolfRoleSlotSchema = z.object({
  label: z.string().max(50).optional().nullable(),
});

/** 配役カード新規作成 body。 */
export const createWerewolfRoleCardSchema = z.object({
  title:       z.string().min(1, "カード見出しは必須です").max(100),
  subtitle:    z.string().max(100).optional().nullable(),
  badge_label: z.string().max(30).optional().nullable(),
  body:        z.string().min(1, "本文は必須です").max(5000),
});

/** 配役カード更新 body。全フィールド optional (部分更新)。 */
export const updateWerewolfRoleCardSchema = z.object({
  title:       z.string().min(1).max(100).optional(),
  subtitle:    z.string().max(100).optional().nullable(),
  badge_label: z.string().max(30).optional().nullable(),
  body:        z.string().min(1).max(5000).optional(),
});

/** カード並び替え body。配下カードの id 順を指定。
 *  API 側は同一 slot 内で全 card_id が網羅されているかチェックする。 */
export const reorderWerewolfRoleCardsSchema = z.object({
  card_ids: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * 公開（publish_status="published"）時の必須項目チェック。
 */
export function validatePublishRequirements(args: {
  title:        string | null;
  pageType:     string;
  settings:     unknown;
  blocks:       Array<{ blockType: string; title: string | null; settingsJson: unknown }>;
}): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!args.title || args.title.trim() === "") {
    errors.push("公開するにはタイトルを入力してください");
  }

  const s = (args.settings ?? {}) as Record<string, unknown>;
  // hint_site は旧名。新名 "hint" でも同じ検証を走らせる。
  if (args.pageType === "hint_site" || args.pageType === "hint") {
    const ctaLabel = (s.header_cta_label as string | undefined)?.trim();
    const ctaUrl   = (s.header_cta_url   as string | undefined)?.trim();
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) {
      errors.push("CTA を使う場合はラベルと URL の両方を入力してください");
    }
    if (ctaUrl && !/^https?:\/\//.test(ctaUrl)) {
      errors.push("CTA の URL は http:// または https:// で始めてください");
    }
    const logoUrl = (s.header_logo_url as string | undefined)?.trim();
    if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
      errors.push("ヘッダーロゴ URL は http:// または https:// で始めてください");
    }
  }

  function walk(blockType: string, title: string | null, settings: unknown, depth: number, label: string) {
    if (blockType === "accordion") {
      const accSettings = (settings ?? {}) as { title?: string; children?: unknown };
      const hasTitle = (accSettings.title?.trim() ?? title?.trim() ?? "") !== "";
      if (!hasTitle) errors.push(`${label}: アコーディオンのタイトルが必要です`);
      if (depth > LIFF_MAX_ACCORDION_DEPTH) {
        errors.push(`${label}: アコーディオンのネストが深すぎます（最大 ${LIFF_MAX_ACCORDION_DEPTH} 階層）`);
      }
      if (Array.isArray(accSettings.children)) {
        accSettings.children.forEach((c, i) => {
          const child = c as { block_type?: string; title?: string | null; settings_json?: unknown };
          if (typeof child?.block_type === "string") {
            walk(child.block_type, child.title ?? null, child.settings_json, depth + 1, `${label} > ${child.block_type}#${i + 1}`);
          }
        });
      }
    } else if (blockType === "image") {
      const imgSettings = (settings ?? {}) as { image_url?: string };
      if (!imgSettings.image_url || imgSettings.image_url.trim() === "") {
        errors.push(`${label}: 画像 URL を設定してください`);
      }
    }
    // button_link は URL 未設定でもエラーにしない（未設定ボタンは renderer 側で非表示=no-op になる）。
    // 以前は publish 時に URL 必須としていたが、編集/保存/公開を阻害しない方針に変更。
  }
  args.blocks.forEach((b, i) => {
    walk(b.blockType, b.title, b.settingsJson, 1, `${b.blockType}#${i + 1}`);
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export const createLiffBlockSchema = z.object({
  block_type:                liffBlockTypeSchema,
  sort_order:                z.number().int().min(0).optional(),
  is_enabled:                z.boolean().optional(),
  title:                     z.string().max(200).optional().nullable(),
  settings_json:             z.record(z.unknown()).optional().default({}),
  visibility_condition_json: visibilityConditionSchema,
});

export const updateLiffBlockSchema = z.object({
  block_type:                liffBlockTypeSchema.optional(),
  sort_order:                z.number().int().min(0).optional(),
  is_enabled:                z.boolean().optional(),
  title:                     z.string().max(200).optional().nullable(),
  settings_json:             z.record(z.unknown()).optional(),
  visibility_condition_json: visibilityConditionSchema,
});

export const reorderLiffBlocksSchema = z.object({
  block_ids: z.array(z.string().uuid()).min(1),
});

// ── 一括保存（ページ設定 + ブロック全件を 1 リクエストで保存） ──
// blocks は「保存後にこのページに存在すべき全ブロック」を並び順で渡す。
// id は既存ブロックの UUID（未指定 / temp- 始まりは新規作成扱い）。
const bulkSaveLiffBlockSchema = z.object({
  id:                        z.string().optional(),
  block_type:                liffBlockTypeSchema,
  title:                     z.string().max(200).optional().nullable(),
  is_enabled:                z.boolean().optional(),
  settings_json:             z.record(z.unknown()).optional().default({}),
  visibility_condition_json: visibilityConditionSchema,
});

export const bulkSaveLiffPageSchema = z.object({
  is_enabled:     z.boolean().optional(),
  title:          z.string().max(LIFF_PAGE_TITLE_MAX).optional().nullable(),
  description:    z.string().max(1000).optional().nullable(),
  page_type:      z.enum(LIFF_PAGE_TYPES).optional().transform((v) => {
    if (v === "hint_site") return "hint" as const;
    return v;
  }),
  publish_status: z.enum(LIFF_PUBLISH_STATUSES).optional(),
  settings_json:  liffPageConfigSettingsSchema.optional(),
  blocks:         z.array(bulkSaveLiffBlockSchema).max(200),
});

// ────────────────────────────────────────────────
// Location — ビーコン / QR チェックインポイント
// ────────────────────────────────────────────────

const latSchema  = z.number().min(-90).max(90);
const lngSchema  = z.number().min(-180).max(180);
const checkinModeSchema = z.enum(["qr_only", "gps_only", "qr_and_gps"]).default("qr_only");

// QR 成功時に送るメッセージ ID。空文字は null（未設定）に正規化し、値があれば UUID 検証する。
// 同一 Work scope の検証は route 側で DB に対して行う（client 値を信用しない）。
const qrSuccessMessageIdSchema = z.preprocess(
  (v) => (v === "" ? null : v),
  uuidSchema.nullable().optional(),
);

export const createLocationSchema = z.object({
  work_id:          uuidSchema,
  name:             z.string().min(1, "ロケーション名は必須です").max(100),
  description:      z.string().max(500).optional(),
  beacon_uuid:      z.string().max(100).optional(),
  beacon_major:     z.number().int().min(0).max(65535).optional(),
  beacon_minor:     z.number().int().min(0).max(65535).optional(),
  latitude:         latSchema.optional(),
  longitude:        lngSchema.optional(),
  radius_meters:    z.number().int().min(1).max(10000).optional(),
  gps_enabled:      z.boolean().default(false),
  checkin_mode:     checkinModeSchema,
  cooldown_seconds: z.number().int().min(0).max(86400).default(300),
  transition_id:    uuidSchema.optional(),
  qr_success_message_id: qrSuccessMessageIdSchema,
  set_flags:        setFlagsSchema,
  sort_order:       sortSchema,
  is_active:        z.boolean().default(true),
  stamp_enabled:    z.boolean().default(true),
  stamp_label:      z.string().max(100).optional(),
  stamp_order:      z.number().int().min(0).optional(),
}).superRefine((val, ctx) => {
  if (val.checkin_mode === "gps_only" || val.checkin_mode === "qr_and_gps") {
    if (val.latitude === undefined)     ctx.addIssue({ code: "custom", path: ["latitude"],      message: "この方式では緯度が必須です" });
    if (val.longitude === undefined)    ctx.addIssue({ code: "custom", path: ["longitude"],     message: "この方式では経度が必須です" });
    if (val.radius_meters === undefined) ctx.addIssue({ code: "custom", path: ["radius_meters"], message: "この方式では許容半径が必須です" });
  }
});

export const updateLocationSchema = z.object({
  name:             z.string().min(1).max(100).optional(),
  description:      z.string().max(500).optional().nullable(),
  beacon_uuid:      z.string().max(100).optional().nullable(),
  beacon_major:     z.number().int().min(0).max(65535).optional().nullable(),
  beacon_minor:     z.number().int().min(0).max(65535).optional().nullable(),
  latitude:         latSchema.optional().nullable(),
  longitude:        lngSchema.optional().nullable(),
  radius_meters:    z.number().int().min(1).max(10000).optional().nullable(),
  gps_enabled:      z.boolean().optional(),
  checkin_mode:     z.enum(["qr_only", "gps_only", "qr_and_gps"]).optional(),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  transition_id:    uuidSchema.optional().nullable(),
  qr_success_message_id: qrSuccessMessageIdSchema,
  set_flags:        setFlagsSchema,
  sort_order:       z.number().int().min(0).optional(),
  is_active:        z.boolean().optional(),
  stamp_enabled:    z.boolean().optional(),
  stamp_label:      z.string().max(100).optional().nullable(),
  stamp_order:      z.number().int().min(0).optional().nullable(),
});

export const locationQuerySchema = z.object({
  work_id:   uuidSchema,
  is_active: z.coerce.boolean().optional(),
});

export const checkinSchema = z.object({
  line_user_id:    z.string().min(1, "LINE User ID は必須です"),
  location_id:     uuidSchema,
  work_id:         uuidSchema,
  checkin_method:  z.enum(["qr", "gps", "qr_and_gps", "beacon"]).default("qr"),
  lat:             latSchema.optional(),
  lng:             lngSchema.optional(),
}).superRefine((val, ctx) => {
  if (val.checkin_method === "gps" || val.checkin_method === "qr_and_gps") {
    if (val.lat === undefined) ctx.addIssue({ code: "custom", path: ["lat"], message: "GPS チェックインには緯度が必須です" });
    if (val.lng === undefined) ctx.addIssue({ code: "custom", path: ["lng"], message: "GPS チェックインには経度が必須です" });
  }
});

// ────────────────────────────────────────────────
// LineDestination — 遷移先URL定義
// ────────────────────────────────────────────────

export const DESTINATION_TYPES = ["liff", "internal_url", "external_url"] as const;
export const LIFF_TARGET_TYPES = ["work_main", "custom"] as const;

const destinationKeySchema = z.string()
  .min(1, "key は必須です")
  .max(50, "key は50文字以内にしてください")
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "key は小文字英数字・ハイフン・アンダースコアのみ使用可能です");

const queryParamsJsonSchema = z.record(z.string(), z.string()).default({});

export const createDestinationSchema = z.object({
  work_id:           uuidSchema,
  key:               destinationKeySchema,
  name:              z.string().min(1, "名前は必須です").max(100, "名前は100文字以内にしてください"),
  description:       z.string().max(500).optional().nullable(),
  destination_type:  z.enum(DESTINATION_TYPES),
  liff_target_type:  z.enum(LIFF_TARGET_TYPES).optional().nullable(),
  url_or_path:       z.string().max(2000).optional().nullable(),
  query_params_json: queryParamsJsonSchema.optional(),
  is_enabled:        z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.destination_type === "liff" && !data.liff_target_type) {
    ctx.addIssue({ code: "custom", message: "LIFF destination には liff_target_type が必要です", path: ["liff_target_type"] });
  }
  if (data.destination_type === "external_url") {
    if (!data.url_or_path) {
      ctx.addIssue({ code: "custom", message: "外部URLは必須です", path: ["url_or_path"] });
    } else if (!/^https?:\/\/.+/.test(data.url_or_path)) {
      ctx.addIssue({ code: "custom", message: "https:// から始まるURLを入力してください", path: ["url_or_path"] });
    }
  }
  if (data.destination_type === "internal_url") {
    if (!data.url_or_path) {
      ctx.addIssue({ code: "custom", message: "内部パスは必須です", path: ["url_or_path"] });
    } else if (!data.url_or_path.startsWith("/")) {
      ctx.addIssue({ code: "custom", message: "内部パスは / から始めてください", path: ["url_or_path"] });
    }
  }
});

export const updateDestinationSchema = z.object({
  key:               destinationKeySchema.optional(),
  name:              z.string().min(1).max(100).optional(),
  description:       z.string().max(500).optional().nullable(),
  destination_type:  z.enum(DESTINATION_TYPES).optional(),
  liff_target_type:  z.enum(LIFF_TARGET_TYPES).optional().nullable(),
  url_or_path:       z.string().max(2000).optional().nullable(),
  query_params_json: queryParamsJsonSchema.optional(),
  is_enabled:        z.boolean().optional(),
});

// ────────────────────────────────────────────────
// BeaconTrigger — LINE Beacon HWID トリガー
// ────────────────────────────────────────────────

export const BEACON_ACTION_TYPES = ["message", "send_message", "destination", "noop"] as const;
export const BEACON_EVENT_TYPES = ["enter", "stay", "banner"] as const;

const beaconHwidSchema = z.string()
  .min(1, "HWID は必須です")
  .max(64, "HWID は64文字以内にしてください")
  // 入力時はゆるく許容し、サーバー側で normalize → 正規表現チェックを行う
  .regex(/^[\sA-Za-z0-9]+$/, "HWID は半角英数字のみ使用できます");

const beaconEventTypesSchema = z.string()
  .min(1, "発火イベントは必須です")
  .refine(
    (s) => s.split(",").map((x) => x.trim()).filter(Boolean)
      .every((x) => (BEACON_EVENT_TYPES as readonly string[]).includes(x)),
    { message: "発火イベントは enter / stay / banner のいずれかをカンマ区切りで指定してください" },
  );

// 再発火制御フィールド（create / update 共通）。
// valid_from / valid_to は ISO 文字列 or null。z.coerce.date で Date に変換する。
const beaconControlFields = {
  once_per_user:         z.boolean().optional(),
  max_triggers_per_user: z.number().int().min(1).max(1_000_000).optional().nullable(),
  valid_from:            z.coerce.date().optional().nullable(),
  valid_to:              z.coerce.date().optional().nullable(),
  note:                  z.string().max(1000).optional().nullable(),
};

export const createBeaconTriggerSchema = z.object({
  name:             z.string().min(1, "名前は必須です").max(100, "名前は100文字以内にしてください"),
  hwid:             beaconHwidSchema,
  work_id:          z.string().uuid().optional().nullable(),
  /// 紐づけ地点(Location.id)。設定すると「地点到着で自動進行」の待機トリガー(beacon)を消化できる。
  location_id:      z.string().uuid().optional().nullable(),
  enabled:          z.boolean().optional(),
  event_types:      beaconEventTypesSchema.optional(),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  action_type:      z.enum(BEACON_ACTION_TYPES),
  action_payload:   z.record(z.string(), z.unknown()).optional().nullable(),
  ...beaconControlFields,
}).superRefine((val, ctx) => {
  if (val.action_type === "message") {
    const mid = (val.action_payload as Record<string, unknown> | null | undefined)?.message_id;
    if (typeof mid !== "string" || !mid.trim()) {
      ctx.addIssue({ code: "custom", path: ["action_payload", "message_id"], message: "送信するメッセージを選択してください" });
    }
  }
  if (val.valid_from && val.valid_to && val.valid_from > val.valid_to) {
    ctx.addIssue({ code: "custom", path: ["valid_to"], message: "終了日時は開始日時より後にしてください" });
  }
});

export const updateBeaconTriggerSchema = z.object({
  name:             z.string().min(1).max(100).optional(),
  hwid:             beaconHwidSchema.optional(),
  work_id:          z.string().uuid().optional().nullable(),
  location_id:      z.string().uuid().optional().nullable(),
  enabled:          z.boolean().optional(),
  event_types:      beaconEventTypesSchema.optional(),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  action_type:      z.enum(BEACON_ACTION_TYPES).optional(),
  action_payload:   z.record(z.string(), z.unknown()).optional().nullable(),
  ...beaconControlFields,
}).superRefine((val, ctx) => {
  if (val.action_type === "message") {
    const mid = (val.action_payload as Record<string, unknown> | null | undefined)?.message_id;
    if (typeof mid !== "string" || !mid.trim()) {
      ctx.addIssue({ code: "custom", path: ["action_payload", "message_id"], message: "送信するメッセージを選択してください" });
    }
  }
  if (val.valid_from && val.valid_to && val.valid_from > val.valid_to) {
    ctx.addIssue({ code: "custom", path: ["valid_to"], message: "終了日時は開始日時より後にしてください" });
  }
});

// 疑似発火テスト（管理画面・platform admin 用）。本番 Webhook と同じ resolver/sender を通す。
export const testBeaconFireSchema = z.object({
  line_user_id:  z.string().min(1, "lineUserId は必須です").max(100),
  beacon_type:   z.enum(BEACON_EVENT_TYPES).optional(), // 未指定なら "enter"
  dm:            z.string().max(200).optional().nullable(),
  ignore_limits: z.boolean().optional(), // cooldown/once/max を無視（platform admin のみ）
});

// ────────────────────────────────────────────────
// ユーティリティ：バリデーションエラーを整形
// ────────────────────────────────────────────────
export function formatZodErrors(error: z.ZodError): Record<string, string[]> {
  return error.errors.reduce<Record<string, string[]>>((acc, e) => {
    const key = e.path.join(".");
    if (!acc[key]) acc[key] = [];
    acc[key].push(e.message);
    return acc;
  }, {});
}

// ── X投稿管理（X posts）──────────────────────────────
// 任意 URL 系は空文字許可（未設定）。datetime は文字列で受け、route 側で Date 変換。
const xUrlSchema = z.union([z.literal(""), z.string().url("有効なURLを入力してください")]).optional().nullable();

export const createXPostSchema = z.object({
  title:        z.string().max(200).optional().nullable(),
  body:         z.string().max(5000).optional().nullable(),
  hashtags:     z.array(z.string().max(100)).max(30).optional().nullable(),
  image_url:          xUrlSchema,
  uploaded_image_url: xUrlSchema,
  link_url:           xUrlSchema,
  utm_enabled:  z.boolean().optional(),
  utm_name:     z.string().max(100).optional().nullable(),
  utm_source:   z.string().max(100).optional().nullable(),
  utm_medium:   z.string().max(100).optional().nullable(),
  utm_campaign: z.string().max(200).optional().nullable(),
  utm_content:  z.string().max(200).optional().nullable(),
  utm_term:     z.string().max(200).optional().nullable(),
  generated_url: xUrlSchema,
  x_post_url:    xUrlSchema,
  status:       z.enum(["draft", "scheduled", "posted", "archived"]).optional(),
  note:         z.string().max(2000).optional().nullable(),
  posted_at:    z.string().optional().nullable(),
  scheduled_at: z.string().optional().nullable(),
  sort_order:   z.number().int().min(0).optional(),
});

// 更新は全フィールド任意（同形）。
export const updateXPostSchema = createXPostSchema;
