// src/lib/validations/index.ts
// Zod バリデーションスキーマ

import { z } from "zod";

// ────────────────────────────────────────────────
// 共通プリミティブ
// ────────────────────────────────────────────────
const uuidSchema  = z.string().uuid({ message: "有効なUUIDを指定してください" });
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{3,8}$/, "カラーコードは #RGB または #RRGGBB 形式で入力してください").optional();
const urlSchema   = z.string().url({ message: "有効なURLを入力してください" }).optional();
const sortSchema  = z.number().int().min(0).default(0);

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
  system_character_id: z.string().uuid().optional().nullable(),
  /**
   * あいさつメッセージ。最大 1000 文字。
   * null を送ると削除、undefined（省略）は変更なし。
   */
  welcome_message:     z.string().max(1000).optional().nullable(),
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
  work_id:       uuidSchema,
  phase_type:    z.enum(["start", "normal", "ending"]).default("normal"),
  name:          z.string().min(1, "フェーズ名は必須です").max(100),
  description:   z.string().max(500).optional(),
  /** 開始トリガーキーワード（phaseType="start" のみ有効） */
  start_trigger: z.string().max(200).optional().nullable(),
  sort_order:    sortSchema,
  is_active:     z.boolean().default(true),
});

export const updatePhaseSchema = z.object({
  phase_type:    z.enum(["start", "normal", "ending"]).optional(),
  name:          z.string().min(1).max(100).optional(),
  description:   z.string().max(500).optional().nullable(),
  /** 開始トリガーキーワード（null で削除） */
  start_trigger: z.string().max(200).optional().nullable(),
  sort_order:    z.number().int().min(0).optional(),
  is_active:     z.boolean().optional(),
});

export const phaseQuerySchema = z.object({
  work_id:    uuidSchema,
  phase_type: z.enum(["start", "normal", "ending"]).optional(),
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
  label:  z.string().min(1, "ラベルは1文字以上必要です").max(20, "ラベルは20文字以内にしてください"),
  action: z.enum(["text", "url", "next", "hint", "custom"]),
  value:  z.string().max(500).optional(),
});

// ────────────────────────────────────────────────
// Message
// ────────────────────────────────────────────────
/** puzzle answer_match_type 配列スキーマ */
const answerMatchTypeSchema = z
  .array(z.enum(["exact", "ignore_punctuation", "normalize_width"]))
  .min(1, "少なくとも1つのマッチ方式を選択してください")
  .default(["exact"]);

export const createMessageSchema = z.object({
  work_id:          uuidSchema,
  phase_id:         uuidSchema.optional().nullable(),
  character_id:     uuidSchema.optional().nullable(),
  message_type:     z.enum(["text", "image", "riddle", "video", "carousel", "voice", "flex"]).default("text"),
  /** メッセージ役割種別: "start" | "normal" | "response" | "hint" | "puzzle" */
  kind:             z.enum(["start", "normal", "response", "hint", "puzzle"]).default("normal"),
  body:             z.string().max(10000).optional(),
  asset_url:        urlSchema,
  trigger_keyword:  z.string().max(200).optional().nullable(),
  target_segment:   z.string().max(100).optional().nullable(),
  notify_text:      z.string().max(500).optional(),
  riddle_id:        uuidSchema.optional().nullable(),
  quick_replies:    z.array(quickReplyItemSchema).max(13, "クイックリプライは最大13件までです").optional().nullable(),
  alt_text:         z.string().max(400).optional().nullable(),
  flex_payload_json: z.string().max(50000).optional().nullable(),
  // Puzzle fields
  puzzle_type:           z.enum(["text", "image", "video", "carousel"]).optional().nullable(),
  answer:                z.string().max(500).optional().nullable(),
  puzzle_hint_text:      z.string().max(1000).optional().nullable(),
  answer_match_type:     answerMatchTypeSchema,
  correct_action:        z.enum(["text", "text_and_transition", "transition"]).optional().nullable(),
  correct_text:          z.string().max(2000).optional().nullable(),
  incorrect_text:        z.string().max(2000).optional().nullable(),
  correct_next_phase_id: uuidSchema.optional().nullable(),
  sort_order:       sortSchema,
  is_active:        z.boolean().default(true),
}).superRefine((val, ctx) => {
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
      if (!val.alt_text?.trim()) {
        ctx.addIssue({ code: "custom", path: ["alt_text"], message: "altTextを入力してください" });
      }
      if (!val.flex_payload_json?.trim()) {
        ctx.addIssue({ code: "custom", path: ["flex_payload_json"], message: "Flex Message JSONを入力してください" });
      } else {
        try { JSON.parse(val.flex_payload_json); } catch {
          ctx.addIssue({ code: "custom", path: ["flex_payload_json"], message: "JSONの形式が正しくありません" });
        }
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
  kind:              z.enum(["start", "normal", "response", "hint", "puzzle"]).optional(),
  body:              z.string().max(10000).optional().nullable(),
  asset_url:         z.string().url().optional().nullable(),
  trigger_keyword:   z.string().max(200).optional().nullable(),
  target_segment:    z.string().max(100).optional().nullable(),
  notify_text:       z.string().max(500).optional().nullable(),
  riddle_id:         uuidSchema.optional().nullable(),
  quick_replies:     z.array(quickReplyItemSchema).max(13, "クイックリプライは最大13件までです").optional().nullable(),
  alt_text:          z.string().max(400).optional().nullable(),
  flex_payload_json: z.string().max(50000).optional().nullable(),
  // Puzzle fields
  puzzle_type:           z.enum(["text", "image", "video", "carousel"]).optional().nullable(),
  answer:                z.string().max(500).optional().nullable(),
  puzzle_hint_text:      z.string().max(1000).optional().nullable(),
  answer_match_type:     z.array(z.enum(["exact", "ignore_punctuation", "normalize_width"])).optional(),
  correct_action:        z.enum(["text", "text_and_transition", "transition"]).optional().nullable(),
  correct_text:          z.string().max(2000).optional().nullable(),
  incorrect_text:        z.string().max(2000).optional().nullable(),
  correct_next_phase_id: uuidSchema.optional().nullable(),
  sort_order:        z.number().int().min(0).optional(),
  is_active:         z.boolean().optional(),
}).superRefine((val, ctx) => {
  if (val.kind !== "puzzle") {
    if (val.message_type === "text" && val.body === null) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "text型の場合、body を null にはできません" });
    }
    if ((val.message_type === "image" || val.message_type === "video" || val.message_type === "voice") && val.asset_url === null) {
      ctx.addIssue({ code: "custom", path: ["asset_url"], message: `${val.message_type}型の場合、asset_url を null にはできません` });
    }
    if (val.message_type === "flex" && val.flex_payload_json) {
      try { JSON.parse(val.flex_payload_json); } catch {
        ctx.addIssue({ code: "custom", path: ["flex_payload_json"], message: "JSONの形式が正しくありません" });
      }
    }
  }
  if (val.kind === "puzzle") {
    if (
      (val.correct_action === "transition" || val.correct_action === "text_and_transition") &&
      val.correct_next_phase_id === null
    ) {
      ctx.addIssue({ code: "custom", path: ["correct_next_phase_id"], message: "遷移系の correct_action には遷移先フェーズが必須です" });
    }
  }
});

export const messageQuerySchema = z.object({
  work_id:        uuidSchema,
  phase_id:       uuidSchema.optional(),
  character_id:   uuidSchema.optional(),
  message_type:   z.enum(["text", "image", "riddle", "video", "carousel", "voice", "flex"]).optional(),
  is_active:      z.coerce.boolean().optional(),
  with_relations: z.coerce.boolean().default(false),
});

// ────────────────────────────────────────────────
// Runtime（シナリオ実行）
// ────────────────────────────────────────────────
export const startScenarioSchema = z.object({
  line_user_id: z.string().min(1, "line_user_id は必須です").max(100),
  work_id:      uuidSchema,
});

export const advanceScenarioSchema = z.object({
  line_user_id:   z.string().min(1, "line_user_id は必須です").max(100),
  work_id:        uuidSchema,
  label:          z.string().min(1).max(500).optional(),
  transition_id:  uuidSchema.optional(),
}).superRefine((val, ctx) => {
  if (!val.label && !val.transition_id) {
    ctx.addIssue({
      code: "custom",
      path: ["label"],
      message: "label または transition_id のどちらかは必須です",
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
  action_uri:   z.string().url().optional().nullable(),
  sort_order:   sortSchema,
}).superRefine((val, ctx) => {
  if (val.action_type === "message" && !val.action_text) {
    ctx.addIssue({ code: "custom", path: ["action_text"], message: "message タイプには action_text が必須です" });
  }
  if (val.action_type === "postback" && !val.action_data) {
    ctx.addIssue({ code: "custom", path: ["action_data"], message: "postback タイプには action_data が必須です" });
  }
  if (val.action_type === "uri" && !val.action_uri) {
    ctx.addIssue({ code: "custom", path: ["action_uri"], message: "uri タイプには action_uri が必須です" });
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
