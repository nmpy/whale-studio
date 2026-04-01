// src/types/index.ts
// LINE謎解きBot — 共通型定義

// ────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────
export type PublishStatus = "draft" | "active" | "paused";

// ────────────────────────────────────────────────
// クイックリプライ
// ────────────────────────────────────────────────
/** クイックリプライのアクション種別 */
export type QuickReplyAction = "text" | "url" | "next" | "hint" | "custom";

/**
 * クイックリプライ 1件
 * - label     : 表示ラベル（LINE 仕様 max 20文字）
 * - action    : アクション種別
 * - value     : アクションに応じた値（任意）
 *   - text      → 送信するテキスト（省略時は label と同じ）
 *   - url       → 開く URL
 *   - next      → トリガーキーワード（省略時はシステムデフォルト）
 *   - hint      → ヒントキー（例: "hint1" / "hint2"）。タップ時に送信されるテキスト
 *   - custom    → 任意のポストバックデータ
 * - hint_text : action="hint" のときにボットが返信するヒント本文（最大 2000 文字）
 */
export interface QuickReplyItem {
  label:           string;
  action:          QuickReplyAction;
  value?:          string;
  /** action="hint" のとき、ユーザーがタップした際にボットが返信するヒント本文 */
  hint_text?:      string;
  /** action="hint" のとき、hint_text の後に続けて送信する回答誘導メッセージ */
  hint_followup?:  string;
  /** false のとき LINE に表示しない / hint 照合対象外にする（省略 = true） */
  enabled?:        boolean;
}
/**
 * キャラクターアイコン種別。
 * - "image" … 画像 URL 型（推奨・LINE sender.iconUrl 対応）
 * - "text"  … テキストアイコン型（非推奨・既存データ読み取り互換のみ。新規作成は "image" 固定）
 */
export type IconType      = "image" | "text";
export type MessageType   = "text" | "image" | "riddle" | "video" | "carousel" | "voice" | "flex";
export type PhaseType     = "start" | "normal" | "ending";
/** メッセージの役割種別 */
export type MessageKind   = "start" | "normal" | "response" | "hint" | "puzzle";

// ────────────────────────────────────────────────
// Domain models（DB行そのまま — snake_case）
// ────────────────────────────────────────────────
export interface Oa {
  id: string;
  title: string;
  description: string | null;
  channel_id: string;
  /** LINE公式アカウントの Basic ID（例: 613zlngs）。Webhook URL 識別子として使う。 */
  line_oa_id: string | null;
  channel_secret: string;
  channel_access_token: string;
  publish_status: PublishStatus;
  /** LINE リッチメニュー ID（未設定なら null）*/
  rich_menu_id: string | null;
  /** Google Sheets スプレッドシート ID（未設定なら null）*/
  spreadsheet_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Work {
  id: string;
  oa_id: string;
  title: string;
  description: string | null;
  publish_status: PublishStatus;
  sort_order: number;
  /** システムメッセージ送信者として使うキャラクター ID（任意） */
  system_character_id: string | null;
  /**
   * あいさつメッセージ（任意）。
   * 未開始ユーザーが最初に話しかけたときに送信される導入文。
   * 未設定（null）のときはシステムデフォルト文にフォールバックする。
   */
  welcome_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: string;
  work_id: string;
  name: string;
  icon_type: IconType;
  icon_text: string | null;
  icon_image_url: string | null;
  icon_color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Phase {
  id: string;
  work_id: string;
  phase_type: PhaseType;
  name: string;
  description: string | null;
  /** 開始トリガーキーワード（phaseType="start" のみ有効） */
  start_trigger: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transition {
  id: string;
  work_id: string;
  from_phase_id: string;
  to_phase_id: string;
  label: string;
  condition: string | null;
  /** フラグ条件式。空なら常に有効。例: "flags.score >= 10", "flags.has_key == true" */
  flag_condition: string | null;
  /** 遷移実行時に flags へマージする JSON 文字列。例: '{"score": 10}' */
  set_flags: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  work_id: string;
  phase_id: string | null;
  character_id: string | null;
  message_type: MessageType;
  /** メッセージ役割種別: "start" | "normal" | "response" | "hint" */
  kind: MessageKind;
  body: string | null;
  asset_url: string | null;
  /** 応答キーワード */
  trigger_keyword: string | null;
  /** 送信対象セグメント */
  target_segment: string | null;
  /** 通知メッセージ（テキスト以外の種別で使用） */
  notify_text: string | null;
  /** 謎 ID（riddle 種別で使用） */
  riddle_id: string | null;
  /** クイックリプライ設定（null = 未設定） */
  quick_replies: QuickReplyItem[] | null;
  /** Flex Message 代替テキスト */
  alt_text: string | null;
  /** Flex Message JSON ペイロード */
  flex_payload_json: string | null;
  // ── Puzzle（謎）専用フィールド ──
  /** 出題形式（kind="puzzle" のとき使用） */
  puzzle_type: string | null;
  /** 正解テキスト */
  answer: string | null;
  /** ヒントテキスト */
  puzzle_hint_text: string | null;
  /** 表記ゆれ許容設定（配列: ["exact","ignore_punctuation","normalize_width"]） */
  answer_match_type: string[];
  /** 正解時の挙動: "text" | "text_and_transition" | "transition" */
  correct_action: string | null;
  /** 正解時メッセージ */
  correct_text: string | null;
  /** 不正解時メッセージ */
  incorrect_text: string | null;
  /** 正解後遷移先フェーズ ID */
  correct_next_phase_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ────────────────────────────────────────────────
// Request body 型
// ────────────────────────────────────────────────
export interface CreateOaBody {
  title: string;
  description?: string;
  channel_id: string;
  line_oa_id?: string;
  channel_secret: string;
  channel_access_token: string;
  publish_status?: PublishStatus;
}

export interface UpdateOaBody {
  title?: string;
  description?: string;
  channel_id?: string;
  line_oa_id?: string | null;
  channel_secret?: string;
  channel_access_token?: string;
  publish_status?: PublishStatus;
  spreadsheet_id?: string | null;
}

export interface CreateWorkBody {
  oa_id: string;
  title: string;
  description?: string;
  publish_status?: PublishStatus;
  sort_order?: number;
}

export interface UpdateWorkBody {
  title?: string;
  description?: string;
  publish_status?: PublishStatus;
  sort_order?: number;
  /** システムメッセージ送信者キャラクター ID（null で解除） */
  system_character_id?: string | null;
  /**
   * あいさつメッセージ（null で削除）。
   * 未開始ユーザーへの導入文。未設定ならシステムデフォルト文を使用。
   */
  welcome_message?: string | null;
}

export interface CreateCharacterBody {
  work_id: string;
  name: string;
  /** 新規作成は "image" 固定。テキストアイコン型は新規作成不可（既存データ読み取りのみ互換） */
  icon_type?: "image";
  icon_image_url?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateCharacterBody {
  name?: string;
  /** 更新時は "image" のみ許可 */
  icon_type?: "image";
  /** @deprecated テキストアイコン型は廃止。既存データ互換のため null のみ受け付ける */
  icon_text?: null;
  icon_image_url?: string | null;
  /** @deprecated テキストアイコン型廃止に伴い不要。既存データ互換のため null のみ受け付ける */
  icon_color?: null;
  sort_order?: number;
  is_active?: boolean;
}

export interface CreatePhaseBody {
  work_id: string;
  phase_type?: PhaseType;
  name: string;
  description?: string;
  /** 開始トリガーキーワード（phaseType="start" のみ有効） */
  start_trigger?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdatePhaseBody {
  phase_type?: PhaseType;
  name?: string;
  description?: string | null;
  /** 開始トリガーキーワード（null で削除） */
  start_trigger?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface CreateTransitionBody {
  work_id: string;
  from_phase_id: string;
  to_phase_id: string;
  label: string;
  condition?: string;
  /** フラグ条件式。例: "flags.score >= 10", "!flags.used", "flags.has_key == true" */
  flag_condition?: string;
  /** 遷移実行時に flags へマージする JSON 文字列。例: '{"score": 10, "has_key": true}' */
  set_flags?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateTransitionBody {
  to_phase_id?: string;
  label?: string;
  condition?: string | null;
  flag_condition?: string | null;
  set_flags?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface CreateMessageBody {
  work_id: string;
  phase_id?: string | null;
  character_id?: string | null;
  message_type?: MessageType;
  /** メッセージ役割種別 */
  kind?: MessageKind;
  body?: string;
  asset_url?: string;
  trigger_keyword?: string | null;
  target_segment?: string | null;
  notify_text?: string;
  riddle_id?: string | null;
  quick_replies?: QuickReplyItem[] | null;
  alt_text?: string | null;
  flex_payload_json?: string | null;
  // Puzzle fields
  puzzle_type?: string | null;
  answer?: string | null;
  puzzle_hint_text?: string | null;
  answer_match_type?: string[];
  correct_action?: string | null;
  correct_text?: string | null;
  incorrect_text?: string | null;
  correct_next_phase_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateMessageBody {
  phase_id?: string | null;
  character_id?: string | null;
  message_type?: MessageType;
  /** メッセージ役割種別 */
  kind?: MessageKind;
  body?: string | null;
  asset_url?: string | null;
  trigger_keyword?: string | null;
  target_segment?: string | null;
  notify_text?: string | null;
  riddle_id?: string | null;
  quick_replies?: QuickReplyItem[] | null;
  alt_text?: string | null;
  flex_payload_json?: string | null;
  // Puzzle fields
  puzzle_type?: string | null;
  answer?: string | null;
  puzzle_hint_text?: string | null;
  answer_match_type?: string[];
  correct_action?: string | null;
  correct_text?: string | null;
  incorrect_text?: string | null;
  correct_next_phase_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

// ────────────────────────────────────────────────
// API レスポンス共通ラッパー
// ────────────────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ────────────────────────────────────────────────
// UserProgress — ユーザー進行状態
// ────────────────────────────────────────────────
export interface UserProgress {
  id:                 string;
  line_user_id:       string;
  work_id:            string;
  current_phase_id:   string | null;
  reached_ending:     boolean;
  flags:              Record<string, unknown>;
  last_interacted_at: string;
  created_at:         string;
  updated_at:         string;
}

// ────────────────────────────────────────────────
// Runtime — シナリオ実行時レスポンス
// ────────────────────────────────────────────────
export interface RuntimePhaseMessage {
  id:                string;
  message_type:      MessageType;
  body:              string | null;
  asset_url:         string | null;
  /** Flex Message 代替テキスト（message_type = "flex" のとき使用） */
  alt_text:          string | null;
  /** Flex Message JSON ペイロード（message_type = "flex" のとき使用） */
  flex_payload_json: string | null;
  /** メッセージ個別のクイックリプライ（設定時は遷移 quickReply より優先） */
  quick_replies:     QuickReplyItem[] | null;
  sort_order:        number;
  character: {
    id:             string;
    name:           string;
    icon_type:      IconType;
    icon_text:      string | null;
    icon_color:     string | null;
    /** 画像URL型キャラの場合のみ値が入る。LINE sender.iconUrl に使用 */
    icon_image_url: string | null;
  } | null;
}

export interface RuntimeTransition {
  id:             string;
  label:          string;
  condition:      string | null;
  /** この遷移を通ったとき適用されるフラグ更新 JSON */
  set_flags:      string;
  sort_order:     number;
  to_phase:       { id: string; name: string; phase_type: PhaseType };
}

export interface RuntimePhase {
  id:          string;
  phase_type:  PhaseType;
  name:        string;
  description: string | null;
  messages:    RuntimePhaseMessage[];
  /** エンディングフェーズの場合は null（遷移なし） */
  transitions: RuntimeTransition[] | null;
}

export interface RuntimeState {
  progress: UserProgress | null;
  phase:    RuntimePhase | null;
}

// ────────────────────────────────────────────────
// Runtime — リクエストボディ
// ────────────────────────────────────────────────
export interface StartScenarioBody {
  line_user_id: string;
  work_id:      string;
}

export interface AdvanceScenarioBody {
  line_user_id:   string;
  work_id:        string;
  /** 選択した遷移のラベル文字列（またはキーワード） */
  label?:         string;
  /** 遷移 ID を直接指定（ラベルより優先） */
  transition_id?: string;
}

export interface ResetScenarioBody {
  line_user_id: string;
  work_id:      string;
}

// ────────────────────────────────────────────────
// フロント向けリッチレスポンス（リレーション込み）
// ────────────────────────────────────────────────
export interface MessageWithRelations extends Message {
  phase: Pick<Phase, "id" | "name" | "phase_type"> | null;
  character: Pick<Character, "id" | "name" | "icon_type" | "icon_text" | "icon_image_url" | "icon_color"> | null;
}

export interface TransitionWithPhases extends Transition {
  to_phase: Pick<Phase, "id" | "name" | "phase_type">;
}

export interface PhaseWithCounts extends Phase {
  _count: { messages: number; transitionsFrom: number };
}

// ────────────────────────────────────────────────
// FriendAddSettings — 友だち追加設定
// ────────────────────────────────────────────────
export interface FriendAddSettings {
  id:              string;
  oa_id:           string;
  campaign_name:   string | null;
  /** 友だち追加 URL */
  add_url:         string;
  /** QR コード画像 URL（当面未使用） */
  qr_code_url:     string | null;
  /** SNS シェア用 OGP 画像 URL */
  share_image_url: string | null;
  created_at:      string;
  updated_at:      string;
}

export interface PutFriendAddBody {
  campaign_name?:   string | null;
  add_url:          string;
  qr_code_url?:     string | null;
  share_image_url?: string | null;
}

// ────────────────────────────────────────────────
// SnsPost — SNS 投稿管理
// ────────────────────────────────────────────────
export type SnsPlatform = "x" | "instagram" | "line" | "other";

export interface SnsPost {
  id:         string;
  oa_id:      string;
  platform:   SnsPlatform;
  text:       string;
  image_url:  string | null;
  target_url: string | null;
  order:      number;
  created_at: string;
  updated_at: string;
}

export interface CreateSnsPostBody {
  platform:    SnsPlatform;
  text:        string;
  image_url?:  string | null;
  target_url?: string | null;
  order?:      number;
}

export interface UpdateSnsPostBody {
  platform?:   SnsPlatform;
  text?:       string;
  image_url?:  string | null;
  target_url?: string | null;
  order?:      number;
}

// ────────────────────────────────────────────────
// RichMenu — カスタムリッチメニュー
// ────────────────────────────────────────────────
export type RichMenuSize       = "full" | "compact";
export type RichMenuActionType = "message" | "postback" | "uri";

export interface RichMenu {
  id:               string;
  oa_id:            string;
  name:             string;
  chat_bar_text:    string;
  /** "full" (2500×1686) | "compact" (2500×843) */
  size:             RichMenuSize;
  image_url:        string | null;
  line_rich_menu_id: string | null;
  is_active:        boolean;
  created_at:       string;
  updated_at:       string;
}

export interface RichMenuArea {
  id:           string;
  rich_menu_id: string;
  x:            number;
  y:            number;
  width:        number;
  height:       number;
  action_type:  RichMenuActionType;
  action_label: string;
  /** message type: テキスト送信内容 / postback type: displayText */
  action_text:  string | null;
  /** postback type: postback data 文字列 */
  action_data:  string | null;
  /** uri type: 開くURL */
  action_uri:   string | null;
  sort_order:   number;
  created_at:   string;
  updated_at:   string;
}

export interface RichMenuWithAreas extends RichMenu {
  areas: RichMenuArea[];
}

export interface CreateRichMenuBody {
  oa_id:         string;
  name:          string;
  chat_bar_text?: string;
  size?:         RichMenuSize;
  image_url?:    string | null;
  is_active?:    boolean;
  areas:         CreateRichMenuAreaBody[];
}

export interface CreateRichMenuAreaBody {
  x:            number;
  y:            number;
  width:        number;
  height:       number;
  action_type:  RichMenuActionType;
  action_label: string;
  action_text?: string | null;
  action_data?: string | null;
  action_uri?:  string | null;
  sort_order?:  number;
}

export interface UpdateRichMenuBody {
  name?:         string;
  chat_bar_text?: string;
  size?:         RichMenuSize;
  image_url?:    string | null;
  is_active?:    boolean;
  /** 指定した場合は既存エリアをすべて置き換える */
  areas?:        CreateRichMenuAreaBody[];
}

// ────────────────────────────────────────────────
// Riddle — 謎（問題）管理
// ────────────────────────────────────────────────
export type RiddleQuestionType   = "text" | "image" | "video" | "carousel";
export type RiddleMatchCondition = "exact" | "partial" | "case_insensitive" | "normalize_width" | "normalize_kana";
export type RiddleStatus         = "draft" | "published";
export type HintActionType       = "next_hint" | "repeat_hint" | "cancel_hint" | "custom";

export interface CarouselCard {
  title:       string;
  description: string;
  image_url:   string;
}

export interface HintQuickReply {
  label:        string;
  action_type:  HintActionType;
  action_value: string;
}

export interface Hint {
  step:          number;
  text:          string;
  character_id:  string | null;
  quick_replies: HintQuickReply[];
}

export interface Riddle {
  id:                 string;
  oa_id:              string;
  title:              string;
  question_type:      RiddleQuestionType;
  question_text:      string | null;
  question_image_url: string | null;
  question_video_url: string | null;
  question_carousel:  CarouselCard[] | null;
  answer_text:        string;
  match_condition:    RiddleMatchCondition;
  correct_message:    string;
  wrong_message:      string;
  status:             RiddleStatus;
  hints:              Hint[];
  character_id:       string | null;
  target_segment:     string | null;
  created_at:         string;
  updated_at:         string;
}

export interface CreateRiddleBody {
  title:               string;
  question_type:       RiddleQuestionType;
  question_text?:      string | null;
  question_image_url?: string | null;
  question_video_url?: string | null;
  question_carousel?:  CarouselCard[] | null;
  answer_text:         string;
  match_condition:     RiddleMatchCondition;
  correct_message:     string;
  wrong_message:       string;
  status?:             RiddleStatus;
  hints?:              Hint[];
  character_id?:       string | null;
  target_segment?:     string | null;
}

export type UpdateRiddleBody = Partial<CreateRiddleBody>;

export interface CreateHintLogBody {
  oa_id:        string;
  work_id:      string;
  phase_id?:    string | null;
  riddle_id:    string;
  line_user_id: string;
  hint_step:    number;
  event_type:   "hint_shown" | "quick_reply_tapped";
  action_type?: string | null;
  action_value?: string | null;
}

// ────────────────────────────────────────────────
// Segment — オーディエンスセグメント
// ────────────────────────────────────────────────
export type SegmentFilterType = "phase" | "friend_7d" | "inactive_7d";
export type SegmentStatus = "active" | "inactive";

export interface Segment {
  id:          string;
  oa_id:       string;
  name:        string;
  filter_type: SegmentFilterType;
  phase_id:    string | null;
  status:      SegmentStatus;
  created_at:  string;
  updated_at:  string;
}

export interface CreateSegmentBody {
  oa_id:       string;
  name:        string;
  filter_type: SegmentFilterType;
  phase_id?:   string | null;
  status?:     SegmentStatus;
}

export type UpdateSegmentBody = Partial<Omit<CreateSegmentBody, "oa_id">>;

// ────────────────────────────────────────────────
// Tracking — トラッキングリンク管理
// ────────────────────────────────────────────────
export interface Tracking {
  id:          string;
  oa_id:       string;
  name:        string;
  tracking_id: string;
  target_url:  string;
  utm_enabled: boolean;
  /** クリック総数（API が _count を返す場合のみ） */
  click_count: number;
  /** 流入ユーザー数（API が _count を返す場合のみ） */
  user_count:  number;
  created_at:  string;
  updated_at:  string;
}

export interface TrackingEvent {
  id:          string;
  tracking_id: string;
  ip:          string | null;
  user_agent:  string | null;
  referer:     string | null;
  clicked_at:  string;
}

export interface UserTracking {
  id:           string;
  oa_id:        string;
  line_user_id: string;
  tracking_id:  string;
  created_at:   string;
}

export interface CreateTrackingBody {
  oa_id:        string;
  name:         string;
  tracking_id?: string;
  target_url:   string;
  utm_enabled?: boolean;
}

export type UpdateTrackingBody = Partial<Omit<CreateTrackingBody, "oa_id">>;

// ────────────────────────────────────────────────
// Analytics
// ────────────────────────────────────────────────
export interface AnalyticsSummary {
  total_players: number;
  total_clears: number;
  clear_rate: number;
  dropout_rate: number;
  hint_usage_rate: number;
  avg_play_time_min: number;
  median_play_time_min: number;
  min_play_time_min: number;
  max_play_time_min: number;
  avg_completed_play_time_min: number;
}

export interface AnalyticsRealtime {
  currently_playing: number;
  started_today: number;
  cleared_today: number;
  active_last_7d: number;
}

export interface AnalyticsPhaseStats {
  phase_id: string;
  phase_name: string;
  sort_order: number;
  reached: number;
  currently_at: number;
  cleared: number;
  dropped_out: number;
  stuck: number;
  clear_rate: number;
}

export interface AnalyticsDropoutItem {
  phase_id: string;
  phase_name: string;
  dropout_count: number;
  dropout_pct: number;
}

export interface AnalyticsStuckPlayer {
  anonymous_id: string;
  current_phase_name: string;
  stuck_minutes: number;
  last_active: string;
}

export interface AnalyticsPlayerDetail {
  anonymous_id: string;
  current_phase_name: string | null;
  play_time_min: number;
  last_active: string;
  reached_ending: boolean;
  status: "active" | "stuck" | "dropped" | "completed";
}

export interface AnalyticsData {
  work: { id: string; title: string };
  summary: AnalyticsSummary;
  realtime: AnalyticsRealtime;
  phase_stats: AnalyticsPhaseStats[];
  dropout_distribution: AnalyticsDropoutItem[];
  stuck_players: AnalyticsStuckPlayer[];
  player_details: AnalyticsPlayerDetail[];
}

export interface SegmentAnalytics {
  segment_id:        string;
  segment_name:      string;
  filter_type:       string;
  phase_id:          string | null;
  status:            string;
  total_matched:     number;
  total_clears:      number;
  clear_rate:        number;
  avg_play_time_min: number;
  dropout_count:     number;
  dropout_rate:      number;
}

// ────────────────────────────────────────────────
// GlobalCommand — フェーズ横断グローバルコマンド
// ────────────────────────────────────────────────

/** action_type の選択肢 */
export type GlobalCommandActionType = "HINT" | "RESET" | "HELP" | "REPEAT" | "CUSTOM";

export interface GlobalCommand {
  id:          string;
  oa_id:       string;
  keyword:     string;
  action_type: GlobalCommandActionType;
  /** CUSTOM 用メッセージ / HELP 用ガイドテキスト（任意） */
  payload:     string | null;
  is_active:   boolean;
  sort_order:  number;
  created_at:  string;
  updated_at:  string;
}

export interface CreateGlobalCommandBody {
  oa_id:       string;
  keyword:     string;
  action_type: GlobalCommandActionType;
  payload?:    string | null;
  is_active?:  boolean;
  sort_order?: number;
}

export interface UpdateGlobalCommandBody {
  keyword?:     string;
  action_type?: GlobalCommandActionType;
  payload?:     string | null;
  is_active?:   boolean;
  sort_order?:  number;
}
