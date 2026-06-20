// src/types/index.ts
// LINE謎解きBot — 共通型定義

// ────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────
export type PublishStatus = "draft" | "active" | "paused";
/** 既読制御モード */
export type ReadReceiptMode = "inherit" | "immediate" | "delayed" | "before_reply";

/** メッセージ単位の演出タイミング設定（null = 上位設定を継承） */
export interface MessageTimingConfig {
  read_receipt_mode:    ReadReceiptMode | null;
  read_delay_ms:        number | null;
  typing_enabled:       boolean | null;
  typing_min_ms:        number | null;
  typing_max_ms:        number | null;
  loading_enabled:      boolean | null;
  loading_threshold_ms: number | null;
  loading_min_seconds:  number | null;
  loading_max_seconds:  number | null;
}

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
 * - target_type / target_message_id : action="text" のとき、タップ時に特定メッセージを返信
 */
export interface QuickReplyItem {
  label:              string;
  action:             QuickReplyAction;
  value?:             string;
  /** action="hint" のとき、ユーザーがタップした際にボットが返信するヒント本文 */
  hint_text?:         string;
  /** action="hint" のとき、hint_text の後に続けて送信する回答誘導メッセージ */
  hint_followup?:     string;
  /**
   * ヒントボタンの表示順序（1=最初, 2=次, ...）。
   * ヒント段階を管理するためのフィールド。未設定の場合は配列順。
   */
  hint_level?: number;
  /**
   * このヒントを表示した後の「さらにヒント」ボタンラベル。
   * 未設定の場合は "さらにヒント"。
   */
  hint_next_label?: string;
  /**
   * このヒントを表示した後の「問題に戻る」ボタンラベル。
   * 未設定の場合は "問題に戻る"。
   */
  hint_cancel_label?: string;
  /**
   * action="hint" のとき、ヒントを返信するキャラクターの ID。
   * 未設定 or null の場合はシステムキャラクターにフォールバックする。
   */
  hint_character_id?: string | null;
  /** false のとき LINE に表示しない / hint 照合対象外にする（省略 = true） */
  enabled?:           boolean;
  /** action="url" のとき、destination を参照する ID（null = 直URL） */
  destination_id?:    string | null;
  /**
   * タップ時の遷移先種別。action="text" と組み合わせて使用。
   * - "phase"   : 通常のフェーズ遷移（デフォルト動作）
   * - "message" : 指定メッセージを直接返信（フェーズ遷移しない）
   */
  target_type?:       "phase" | "message";
  /** target_type="message" のとき、返信するメッセージの ID */
  target_message_id?: string;
  /**
   * action="text" のとき、このボタンをタップした際に遷移するフェーズの ID。
   * 設定されている場合、phase.transitions ではなくこの ID へ直接遷移する。
   */
  target_phase_id?: string;
  /**
   * このボタンをタップしたときのユーザー入力（ラベル）を受け取る応答メッセージの ID。
   * 設定されると、応答メッセージの trigger_keyword にラベルが自動マージされる。
   * action="hint" のときは使用しない。
   */
  response_message_id?: string;
}
/**
 * キャラクターアイコン種別。
 * - "image" … 画像 URL 型（推奨・LINE sender.iconUrl 対応）
 * - "text"  … テキストアイコン型（非推奨・既存データ読み取り互換のみ。新規作成は "image" 固定）
 */
export type IconType      = "image" | "text";
export type MessageType   = "text" | "image" | "riddle" | "video" | "carousel" | "voice" | "flex";
export type PhaseType     = "start" | "normal" | "ending" | "global";
/** メッセージの役割種別 */
export type MessageKind   = "start" | "normal" | "response" | "hint" | "puzzle" | "system_notice";

/** ヒント表示モード */
export type HintMode = "always" | "on_wrong" | "hidden";

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
  /**
   * サービス停止日時。null = 稼働中 / ISO 文字列 = 停止中 (停止された日時)。
   * 非 null のとき LINE webhook は通常応答せず、message event の replyToken に
   * 対してのみ一律「サービス終了」メッセージを返す。publish_status とは独立。
   */
  service_suspended_at: string | null;
  /** 利用区分（個人/法人）。owner / platform admin 表示モードでの区別用（既定 personal）。 */
  usage_type?: "personal" | "business";
  created_at: string;
  updated_at: string;
}

export interface Work {
  id: string;
  /** 公開 URL 用の短縮 ID。LIFF / チェックイン URL で使う */
  public_id?: string;
  oa_id: string;
  title: string;
  description: string | null;
  publish_status: PublishStatus;
  sort_order: number;
  /** LIFF プレイヤー機能 (作品メニュー + 個別 LIFF ページ) の有効/無効。
   *  既定 true。false にすると `/liff/w/[workPublicId]` などからアクセスできなくなる。 */
  liff_enabled: boolean;
  /** 途中再開機能の有効/無効（作品単位）。既定 true。
   *  false にすると、途中状態があっても再開選択肢を出さず最初から開始する。
   *  一覧 API では返さないため optional。 */
  resume_enabled?: boolean;
  /** システムメッセージ送信者として使うキャラクター ID（任意） */
  system_character_id: string | null;
  /** 作品メニューホームの任意設定（title/description/image_url）。詳細 GET でのみ返す。 */
  liff_home_settings?: LiffHomeSettings;
  /**
   * あいさつメッセージ（任意）。
   * 未開始ユーザーが最初に話しかけたときに送信される導入文。
   * 未設定（null）のときはシステムデフォルト文にフォールバックする。
   */
  welcome_message: string | null;
  /**
   * 友だち追加（follow）時の動作（作品単位）。
   * "auto_start"（既定・友だち追加直後に自動開始）/ "welcome_wait"（あいさつを送り「はじめる」を待つ）/ "none"（何もしない）。
   */
  follow_action?: "auto_start" | "welcome_wait" | "none";
  // ── 演出デフォルト設定 ──
  read_receipt_mode: ReadReceiptMode | null;
  read_delay_ms: number | null;
  typing_enabled: boolean | null;
  typing_min_ms: number | null;
  typing_max_ms: number | null;
  loading_enabled: boolean | null;
  loading_threshold_ms: number | null;
  loading_min_seconds: number | null;
  loading_max_seconds: number | null;
  created_at: string;
  updated_at: string;
}

/** 作品単位の演出タイミング設定（MessageTimingConfig と同じ形状） */
export type WorkTimingConfig = MessageTimingConfig;

export interface Character {
  id: string;
  work_id: string;
  name: string;
  /** キャラクター紹介文（任意・null 可）。LIFF 表示は別 PR(CR2)。 */
  description: string | null;
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
  /**
   * 再開時あらすじ（任意）。
   * プレイヤーが途中離脱後「途中から再開する」を選んだとき、
   * このフェーズ先頭メッセージの前に送られる補助テキスト。
   * 将来的に Work 単位でも持てる可能性があるが、現時点では Phase に保持。
   */
  resume_summary: string | null;
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

/** 画像メッセージのタップ時アクション種別。 */
export type ImageActionType = "none" | "message" | "uri" | "liff" | "postback";

/** 画像メッセージのタップ時アクション (discriminated union, 主に webhook / preview で使用)。 */
export type MessageImageAction =
  | { type: "none" }
  | { type: "message"; text: string }
  | { type: "uri"; url: string }
  | { type: "liff"; pageId: string }
  | { type: "postback"; data: string; displayText?: string };

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
  /** 連続送信: このメッセージの後に続けて送信するメッセージ ID（null = チェーンなし） */
  next_message_id: string | null;
  /** Flex Message 代替テキスト */
  alt_text: string | null;
  /** Flex Message JSON ペイロード */
  flex_payload_json: string | null;
  // ── Puzzle（謎）専用フィールド ──
  /** 出題形式（kind="puzzle" のとき使用） */
  puzzle_type: string | null;
  /** 正解テキスト（後方互換: 先頭正解を保持） */
  answer: string | null;
  /** 複数正解（いずれか一致で正解）。null/空 = 単一 answer のみ使用 */
  answers: string[] | null;
  /** ヒントテキスト */
  puzzle_hint_text: string | null;
  /** ヒント表示モード: always=常時 / on_wrong=不正解時のみ / hidden=非表示 */
  hint_mode: HintMode;
  /** 表記ゆれ許容設定（配列: ["exact","ignore_punctuation","normalize_width"]） */
  answer_match_type: string[];
  /** 正解時の挙動: "text" | "text_and_transition" | "transition" */
  correct_action: string | null;
  /** 正解時メッセージ */
  correct_text: string | null;
  /** 正解メッセージの発話キャラクター ID（null = 問題本文 character → デフォルトにフォールバック） */
  correct_character_id: string | null;
  /** 不正解時メッセージ */
  incorrect_text: string | null;
  /** 不正解メッセージの発話キャラクター ID（null = 問題本文 character → デフォルトにフォールバック） */
  incorrect_character_id: string | null;
  /** 不正解時クイックリプライ（JSON / QuickReplyItem[]）*/
  incorrect_quick_replies: QuickReplyItem[] | null;
  /** 正解後遷移先フェーズ ID */
  correct_next_phase_id: string | null;
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = 即時送信 */
  lag_ms: number;
  // ── 演出設定（既読・typing・ローディング）──
  /** 既読制御モード: null=inherit */
  read_receipt_mode: ReadReceiptMode | null;
  /** 既読遅延（ms） */
  read_delay_ms: number | null;
  /** typing 風の間を有効にするか */
  typing_enabled: boolean | null;
  /** typing 最小待機（ms） */
  typing_min_ms: number | null;
  /** typing 最大待機（ms） */
  typing_max_ms: number | null;
  /** ローディングアニメーション制御 */
  loading_enabled: boolean | null;
  /** ローディング表示閾値（ms） */
  loading_threshold_ms: number | null;
  /** ローディング最小秒数 */
  loading_min_seconds: number | null;
  /** ローディング最大秒数 */
  loading_max_seconds: number | null;
  // ── タップ遷移先 ──
  /** タップ時の遷移先 destination ID（null = 未使用） */
  tap_destination_id: string | null;
  /** タップ時の直接URL（destination 未使用時のフォールバック） */
  tap_url: string | null;
  // ── 画像タップ時アクション (messageType="image" 用) ──
  /** タップ時のアクション種別。null = アクションなし (= 通常の Image Message)。
   *  値があるときは LINE 送信側で Flex Message に自動変換される。 */
  image_action_type: ImageActionType | null;
  /** type="message": タップ時にプレイヤーから送信されるテキスト */
  image_action_text: string | null;
  /** type="uri": タップで開く外部 URL (HTTPS のみ) */
  image_action_url: string | null;
  /** type="liff": タップで開く LIFF ページ ID */
  image_action_liff_page_id: string | null;
  /** type="postback": postback data */
  image_action_postback_data: string | null;
  // ── 自由入力受付（このメッセージ送信後にユーザーの次入力を保存する） ──
  /** このメッセージ送信後、次のテキスト入力を変数として保存するか。 */
  free_input_enabled: boolean;
  /** 保存先の変数名。任意 — null/空欄なら入力をどこにも保存しない (ログ用途)。
   *  値があるときは ^[a-zA-Z_][a-zA-Z0-9_]*$ で validation。 */
  free_input_variable_key: string | null;
  /** 自由入力を受け取った後に送信する次メッセージ ID。連続送信用の next_message_id とは別管理。 */
  free_input_next_message_id: string | null;
  /** 送信後の待機トリガー（地点到着で自動進行）。"qr" | "gps" | "beacon" | null。 */
  checkin_trigger_type?: string | null;
  /** 待機トリガーの対象地点(Location.id)。 */
  checkin_trigger_location_id?: string | null;
  /** 待機トリガーの検知成功時に送る次メッセージ(Message.id)。 */
  checkin_trigger_next_message_id?: string | null;
  /** 待機トリガーの検知成功時に進める次フェーズ(Phase.id)。 */
  checkin_trigger_next_phase_id?: string | null;
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
  /**
   * サービス稼働状態のトグル。true = 停止中に切替 / false = 稼働中に戻す。
   * undefined (= 省略) なら変更なし。サーバー側で `serviceSuspendedAt` (DateTime?) に変換される。
   */
  service_suspended?: boolean;
  /** 利用区分（個人/法人）。owner のみ更新可。 */
  usage_type?: "personal" | "business";
}

export interface CreateWorkBody {
  oa_id: string;
  title: string;
  description?: string;
  publish_status?: PublishStatus;
  sort_order?: number;
}

/** ホーム（作品単位）フォント。LIFF ホーム + 配下の各 LIFF ページにカスケード適用する。
 *  "default"（または未設定/null）は従来フォント（LINE Seed JP 系）を維持。 */
export type LiffHomeFontFamily = "default" | "meiryo" | "hiragino" | "yu_gothic" | "ud";

/** 作品メニューホーム（`/liff/w/{publicId}`）の任意設定。すべて未設定可。
 *  未設定（null）のときは従来表示（見出し「ホーム」・説明/画像なし）にフォールバックする。 */
export interface LiffHomeSettings {
  /** ホーム見出し（本文側）。null/空のとき本文タイトルは非表示（作品名 fallback しない）。 */
  title:       string | null;
  /** ホーム説明文（複数行可）。null/空のとき非表示。 */
  description: string | null;
  /** ホーム画像 URL。null/空のとき非表示。 */
  image_url:   string | null;
  /** LIFF デフォルトヘッダー用タイトル（document.title に反映）。null/空のとき作品名等にフォールバック。 */
  header_title: string | null;
  /** ホーム（作品単位）フォント。null/未設定/"default" は従来フォント。 */
  font_family: LiffHomeFontFamily | null;
  /** ホームメニューの表示モード。"list" = 縦並びリスト / "card"(既定/未設定) = 2列カードグリッド。
   *  未設定の既存作品は "card" 扱いで従来表示を維持する。 */
  home_menu_layout: "card" | "list";
}

export interface UpdateWorkBody {
  title?: string;
  description?: string;
  publish_status?: PublishStatus;
  sort_order?: number;
  /** LIFF プレイヤー機能の有効/無効。 */
  liff_enabled?: boolean;
  /** 作品メニューホームの任意設定（title/description/image_url/header_title/font_family）。指定キーのみ更新、空文字/"default" は解除。 */
  liff_home_settings?: {
    title?:        string | null;
    description?:  string | null;
    image_url?:    string | null;
    header_title?: string | null;
    font_family?:  LiffHomeFontFamily | null;
    /** ホームメニュー表示モード。"card"/null/未指定 は既定(カード)に解除。 */
    home_menu_layout?: "card" | "list" | null;
  };
  /** 途中再開機能の有効/無効（作品単位）。 */
  resume_enabled?: boolean;
  /** システムメッセージ送信者キャラクター ID（null で解除） */
  system_character_id?: string | null;
  /**
   * あいさつメッセージ（null で削除）。
   * 未開始ユーザーへの導入文。未設定ならシステムデフォルト文を使用。
   */
  welcome_message?: string | null;
  /** 友だち追加時の動作。"auto_start" | "welcome_wait" | "none"。 */
  follow_action?: "auto_start" | "welcome_wait" | "none";
  // 演出デフォルト設定
  read_receipt_mode?: ReadReceiptMode | null;
  read_delay_ms?: number | null;
  typing_enabled?: boolean | null;
  typing_min_ms?: number | null;
  typing_max_ms?: number | null;
  loading_enabled?: boolean | null;
  loading_threshold_ms?: number | null;
  loading_min_seconds?: number | null;
  loading_max_seconds?: number | null;
}

export interface CreateCharacterBody {
  work_id: string;
  name: string;
  /** キャラクター紹介文（任意）。空文字 / 省略は null として保存される。 */
  description?: string | null;
  /** 新規作成は "image" 固定。テキストアイコン型は新規作成不可（既存データ読み取りのみ互換） */
  icon_type?: "image";
  icon_image_url?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateCharacterBody {
  name?: string;
  /** キャラクター紹介文（任意）。省略＝変更なし / null・空文字＝クリア。 */
  description?: string | null;
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
  /** 再開時あらすじ（null で未設定） */
  resume_summary?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdatePhaseBody {
  phase_type?: PhaseType;
  name?: string;
  description?: string | null;
  /** 開始トリガーキーワード（null で削除） */
  start_trigger?: string | null;
  /** 再開時あらすじ（null で削除） */
  resume_summary?: string | null;
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
  /** 連続送信チェーン先メッセージ ID */
  next_message_id?: string | null;
  alt_text?: string | null;
  flex_payload_json?: string | null;
  // Puzzle fields
  puzzle_type?: string | null;
  answer?: string | null;
  /** 複数正解（いずれか一致で正解）。trim・空除外・重複除外して保存される */
  answers?: string[] | null;
  puzzle_hint_text?: string | null;
  answer_match_type?: string[];
  correct_action?: string | null;
  correct_text?: string | null;
  /** 正解メッセージの発話キャラクター ID */
  correct_character_id?: string | null;
  incorrect_text?: string | null;
  /** 不正解メッセージの発話キャラクター ID */
  incorrect_character_id?: string | null;
  incorrect_quick_replies?: QuickReplyItem[] | null;
  correct_next_phase_id?: string | null;
  /** ヒント表示モード */
  hint_mode?: HintMode;
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = 即時送信 */
  lag_ms?: number;
  // 演出設定
  read_receipt_mode?: ReadReceiptMode | null;
  read_delay_ms?: number | null;
  typing_enabled?: boolean | null;
  typing_min_ms?: number | null;
  typing_max_ms?: number | null;
  loading_enabled?: boolean | null;
  loading_threshold_ms?: number | null;
  loading_min_seconds?: number | null;
  loading_max_seconds?: number | null;
  // タップ遷移先
  tap_destination_id?: string | null;
  tap_url?: string | null;
  // 画像タップ時アクション
  image_action_type?: ImageActionType | null;
  image_action_text?: string | null;
  image_action_url?: string | null;
  image_action_liff_page_id?: string | null;
  image_action_postback_data?: string | null;
  // 自由入力受付
  free_input_enabled?: boolean;
  free_input_variable_key?: string | null;
  free_input_next_message_id?: string | null;
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
  /** 連続送信チェーン先メッセージ ID */
  next_message_id?: string | null;
  alt_text?: string | null;
  flex_payload_json?: string | null;
  // Puzzle fields
  puzzle_type?: string | null;
  answer?: string | null;
  /** 複数正解（いずれか一致で正解）。trim・空除外・重複除外して保存される */
  answers?: string[] | null;
  puzzle_hint_text?: string | null;
  answer_match_type?: string[];
  correct_action?: string | null;
  correct_text?: string | null;
  /** 正解メッセージの発話キャラクター ID */
  correct_character_id?: string | null;
  incorrect_text?: string | null;
  /** 不正解メッセージの発話キャラクター ID */
  incorrect_character_id?: string | null;
  incorrect_quick_replies?: QuickReplyItem[] | null;
  correct_next_phase_id?: string | null;
  /** ヒント表示モード */
  hint_mode?: HintMode;
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = 即時送信 */
  lag_ms?: number;
  // 演出設定
  read_receipt_mode?: ReadReceiptMode | null;
  read_delay_ms?: number | null;
  typing_enabled?: boolean | null;
  typing_min_ms?: number | null;
  typing_max_ms?: number | null;
  loading_enabled?: boolean | null;
  loading_threshold_ms?: number | null;
  loading_min_seconds?: number | null;
  loading_max_seconds?: number | null;
  // タップ遷移先
  tap_destination_id?: string | null;
  tap_url?: string | null;
  // 画像タップ時アクション
  image_action_type?: ImageActionType | null;
  image_action_text?: string | null;
  image_action_url?: string | null;
  image_action_liff_page_id?: string | null;
  image_action_postback_data?: string | null;
  // 自由入力受付
  free_input_enabled?: boolean;
  free_input_variable_key?: string | null;
  free_input_next_message_id?: string | null;
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
    /** 追加情報。Zod validation error は `field → string[]` を入れる (= 既存挙動)。
     *  PLAN_REQUIRED などの単一値の付加情報は string を直接入れる。 */
    details?: Record<string, string | string[]>;
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
  /** 条件分岐 / set_flags 用フラグ JSON (例: {"hint_used": true, "score": 10})。 */
  flags:              Record<string, unknown>;
  /** ユーザー入力で保存された変数 (自由入力 / アンケート等)。
   *  flags とは意味論を分離: こちらはユーザー固有データ。 */
  variables:          Record<string, string>;
  /** 自由入力待ち状態のメタ情報 (null = 通常状態)。 */
  waiting_for_input:  WaitingForInputState | null;
  last_interacted_at: string;
  created_at:         string;
  updated_at:         string;
}

/** 自由入力待ち状態のメタ情報。
 *  Message.free_input_enabled=true のメッセージ送信時に立ち、
 *  次のテキスト入力で消化される。 */
export interface WaitingForInputState {
  /** どのメッセージが受付状態にしたかの参照 (デバッグ・ログ用)。 */
  messageId:     string;
  /** 入力を保存する変数名。null = どこにも保存しない (ログ用途・次メッセージへの差し込みなし)。 */
  variableKey:   string | null;
  /** 入力後に進む次メッセージ ID。 */
  nextMessageId: string | null;
  /** いつ受付状態になったか (ISO 文字列、デバッグ用)。 */
  setAt:         string;
}

// ────────────────────────────────────────────────
// Runtime — シナリオ実行時レスポンス
// ────────────────────────────────────────────────
export interface RuntimePhaseMessage {
  id:                string;
  /** メッセージ種別: "normal" | "start" | "puzzle" | "response" | "hint" | "system_notice" */
  kind:              string;
  message_type:      MessageType;
  body:              string | null;
  asset_url:         string | null;
  /** Flex Message 代替テキスト（message_type = "flex" のとき使用） */
  alt_text:          string | null;
  /** Flex Message JSON ペイロード（message_type = "flex" のとき使用） */
  flex_payload_json: string | null;
  /** メッセージ個別のクイックリプライ（設定時は遷移 quickReply より優先） */
  quick_replies:     QuickReplyItem[] | null;
  /** 前のメッセージ送信後この発話まで待機するミリ秒数。0 = プレビューが自動計算 */
  lag_ms:            number;
  /** ヒント表示モード */
  hint_mode: HintMode;
  sort_order:        number;
  /** メッセージ単位の演出タイミング設定 */
  timing: MessageTimingConfig | null;
  /** タップ遷移先 destination ID */
  tap_destination_id: string | null;
  /** タップ遷移先 直接URL */
  tap_url: string | null;
  // 画像タップ時アクション (messageType="image" 用)
  image_action_type:          ImageActionType | null;
  image_action_text:          string | null;
  image_action_url:           string | null;
  image_action_liff_page_id:  string | null;
  image_action_postback_data: string | null;
  /** 連続送信チェーン先メッセージ ID（null = チェーンなし）。
   *  buildPhaseMessages で chain head / continuation を識別し、
   *  per-chain で QR tail / 順序を制御するために使う。
   *  optional: スプレッドシート由来 / playground 等の synthetic な
   *  RuntimePhaseMessage では未指定でも no chain と等価に扱う。 */
  next_message_id?:  string | null;
  /** 自由入力受付フラグ。true の場合、buildPhaseMessages は
   *  この message を含むチェーンの末尾を「自由入力プロンプト終端」と見なし、
   *  phase 全体の iteration もそこで停止する (= 後続の独立 head は送らない)。
   *  応答メッセージは free_input_next_message_id 経由でユーザー入力後に送る。
   *  optional: synthetic な RuntimePhaseMessage では false 相当の扱い。 */
  free_input_enabled?: boolean;
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

/** 開始待機中に表示するトリガーボタン情報 */
export interface StartTrigger {
  /** QR ボタンに表示するラベル */
  label:   string;
  /** 押下時に advance へ送るテキスト */
  trigger: string;
}

export interface RuntimeState {
  progress:        UserProgress | null;
  phase:           RuntimePhase | null;
  /** 開始待機中（currentPhaseId=null）のときのみ設定。押下で物語が始まるトリガー一覧 */
  start_triggers?: StartTrigger[];
}

// ────────────────────────────────────────────────
// Runtime — リクエストボディ
// ────────────────────────────────────────────────
export interface StartScenarioBody {
  line_user_id: string;
  work_id:      string;
}

export interface AdvanceScenarioBody {
  line_user_id:    string;
  work_id:         string;
  /** 選択した遷移のラベル文字列（またはキーワード） */
  label?:          string;
  /** 遷移 ID を直接指定（ラベルより優先） */
  transition_id?:  string;
  /** QR の target_phase_id による直接フェーズジャンプ */
  target_phase_id?: string;
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
  action_uri:      string | null;
  destination_id:  string | null;
  sort_order:      number;
  created_at:      string;
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
  action_uri?:      string | null;
  destination_id?:  string | null;
  sort_order?:      number;
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
  /** 作品スコープ管理用（Phase 3 以降）。null = OA スコープのまま */
  work_id:            string | null;
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
  /** 作品スコープ管理用（省略可・null = OA スコープのまま） */
  work_id?:            string | null;
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

// ────────────────────────────────────────────────
// LIFF ページ設定
// ────────────────────────────────────────────────

export type LiffBlockType =
  | "free_text"
  | "start_button"
  | "resume_button"
  | "progress"
  | "evidence_list"
  | "hint_list"
  | "character_list"
  | "image"
  | "video"
  // ── ヒントサイト用ブロック ────────────────────
  | "heading"
  | "text"
  | "warning"
  | "button_link"
  | "divider"
  | "accordion"
  // ── ロケーションチェックイン用 ──
  | "code_reader"
  // ── 謎・問題（到達済みの問題一覧） ──
  | "riddle_list"
  // ── チェックイン履歴（プレイヤー本人の訪問履歴） ──
  | "checkin_history";

export type VisibilityCondition = "always" | "before_start" | "in_progress" | "completed";

/** LIFF ページ種別 — 表示ロジック分岐用
 *
 *  - default:   既存のプレイヤー向けブロックページ
 *  - hint:      ヒントサイト（旧 "hint_site" の後継。データ migration 済み）
 *  - faq:       よくある質問
 *  - survey:    アンケート
 *  - location:  ロケーション履歴（チェックイン履歴の表示）
 *  - character: キャラクター情報 (作品メニュー shell のタブ用。本文ブロックは default と同じ
 *               LiffPageBlock を使う想定だが、未登録ならプレイヤー側で空状態を表示する)
 *  - werewolf:  人狼 / 配役閲覧モード (PR Phase 1)。GM がプレイヤーごとに配役カードを
 *               配布するゲーム向け。LiffPageBlock は使わず、専用テーブル
 *               (WerewolfTitle / WerewolfRoleSlot / WerewolfRoleCard) を持つ。
 *
 *  互換性: 旧データの "hint_site" は読み込み時に "hint" として扱う。
 *  Zod (`LIFF_PAGE_TYPES`) では両方を受理し、保存は "hint" に正規化する。
 *
 *  DB は `pageType String @default("default")` で enum ではないため、新 pageType 追加に
 *  Prisma migration は不要 (werewolf 用の専用テーブル migration は別で持つ)。 */
export type LiffPageType = "default" | "hint" | "faq" | "survey" | "location" | "character" | "werewolf" | "contact" | "puzzle";

/** 旧データ互換用。ストレージから読んだ値を正規化する。 */
export function normalizeLiffPageType(value: string | null | undefined): LiffPageType {
  if (value === "hint_site") return "hint";
  if (
    value === "hint" || value === "faq" || value === "survey" ||
    value === "location" || value === "character" || value === "werewolf" ||
    value === "contact" || value === "puzzle"
  ) return value;
  return "default";
}

/** LIFF ページの公開状態（draft = 編集中 / published = 公開中 / archived = 退避） */
export type LiffPublishStatus = "draft" | "published" | "archived";

/** セクション色のバリエーション（テーマで色を出し分けるためのキー） */
export type LiffSectionVariant = "default" | "dark" | "purple";

/** 画像表示サイズ */
export type LiffImageSize = "normal" | "wide" | "full";

export interface FreeTextSettings {
  body?: string;
  align?: "left" | "center";
  emphasis?: "normal" | "strong";
}

/** ブロック用ボタンデザイン。`LIFF_BUTTON_VARIANTS`（primitives/LiffButton）と揃える。
 *  未設定は各ブロックの既定 variant を維持する。 */
export type LiffBlockButtonVariant = "primary" | "outline" | "ghost" | "dark" | "danger";

export interface StartButtonSettings {
  label?: string;
  confirm_message?: string;
  api_action?: string;
  /** ボタンデザイン。未設定は既定 "primary"。 */
  button_variant?: LiffBlockButtonVariant;
}

export interface ResumeButtonSettings {
  label?: string;
  /** ボタンデザイン。未設定は既定 "outline"。 */
  button_variant?: LiffBlockButtonVariant;
}

export interface ProgressSettings {
  display_format?: "bar" | "text";
  show_denominator?: boolean;
}

export interface EvidenceListSettings {
  max_display_count?: number;
  hide_undiscovered?: boolean;
  empty_message?: string;
}

export interface HintListSettings {
  max_display_count?: number;
  empty_message?: string;
}

export interface CharacterListSettings {
  show_icon?: boolean;
  show_description?: boolean;
}

export interface ImageBlockSettings {
  image_url?: string;
  alt?: string;
  caption?: string;
  /** 表示サイズ（normal=通常 / wide=コンテナ余白なし / full=画面端まで） */
  size?: LiffImageSize;
  /** PR-BLK4b: 表示枠の比率（size とは別軸）。
   *  "original"(既定/未設定)→ 元画像の比率 / "1:1"|"4:3"|"16:9"→ その比率で枠表示。 */
  aspect_ratio?: "original" | "1:1" | "4:3" | "16:9";
}

export interface VideoBlockSettings {
  video_url?: string;
  poster_url?: string;
  caption?: string;
}

// ── ヒントサイト用ブロック設定 ──────────────────
/** 文字ウェイトの 3 段階。デフォルトは block の種類によって異なる:
 *  - heading: bold (見出しなので強め)
 *  - text:    normal (本文)
 *  値が無いブロックは renderer 側で default を当てる。 */
export type LiffFontWeight = "normal" | "medium" | "bold";

/** 見出しレベル 1〜5。default は 2。
 *  数値で扱うか文字列で扱うかは型に表現せず、numeric union で固定する。 */
export type LiffHeadingLevel = 1 | 2 | 3 | 4 | 5;

export interface HeadingSettings {
  text?:        string;
  level?:       LiffHeadingLevel;
  align?:       "left" | "center";
  /** 文字ウェイト。未指定なら bold (見出しの既定) */
  font_weight?: LiffFontWeight;
}

export interface TextSettings {
  body?:        string;
  align?:       "left" | "center";
  /** 既存互換: "strong" は font_weight: "bold" 相当として renderer 側で読む */
  emphasis?:    "normal" | "strong";
  /** 文字ウェイト。未指定なら normal */
  font_weight?: LiffFontWeight;
}

export interface WarningSettings {
  body?: string;
  /** "spoiler" | "info" | "danger" — UIスタイルのヒント */
  tone?: "spoiler" | "info" | "danger";
  /** PR-BLK4a: 左側に表示するアイコン。
   *  "auto"(既定/未設定)→ tone から自動 / "none"→非表示 / "warning"|"info"|"alert"→明示指定。 */
  icon?: "auto" | "none" | "warning" | "info" | "alert";
}

export interface ButtonLinkSettings {
  label?: string;
  /** 解決済みの遷移先 URL（renderer はこの値を使う）。
   *  link_type が liff_page / location のときも、選択時に実URLへ解決してここに格納する。 */
  url?: string;
  /** 外部リンクとして開くか（LIFF外で開く） */
  open_external?: boolean;
  variant?: LiffSectionVariant;
  /** ボタンデザイン。設定時は legacy `variant` より優先して LiffButton variant を適用。
   *  未設定は従来の `variant`(default/dark/purple) に従う。 */
  button_variant?: LiffBlockButtonVariant;
  /** 遷移先タイプ。未指定（既存データ）は "external" として扱う（後方互換）。 */
  link_type?: "external" | "liff_page" | "location";
  /** link_type="liff_page" のとき選択された LIFF ページの ID（参照保持・再表示用）。 */
  liff_page_id?: string;
  /** link_type="location" のとき選択されたロケーションの ID（参照保持・再表示用）。 */
  location_id?: string;
}

export interface DividerSettings {
  /** "solid" | "dashed"。省略時は solid */
  style?: "solid" | "dashed";
}

/** 「謎・問題」ブロック設定。プレイヤーが到達済みの謎・問題を LIFF 上で一覧する。 */
export interface RiddleListSettings {
  /** 見出し（未設定は「謎・問題」）。 */
  title?: string;
  /** 最大表示件数（未設定は全件）。 */
  max_count?: number;
  /** 状態ラベル（出題中 等）を表示するか（既定 true）。 */
  show_status?: boolean;
  /** PR-PZ2.1: 一覧見出しの表示名モード。
   *  "riddle"→「謎」/ "question"→「問題」/ "custom"→ heading_custom（空なら fallback）。
   *  未設定は既存互換（title?.trim() || "謎・問題"）。 */
  heading_mode?: "riddle" | "question" | "custom";
  /** heading_mode="custom" のときの自由入力見出し（空・未設定は fallback）。 */
  heading_custom?: string;
  /** 一覧見出し（h3）自体を表示するか（既定 true）。false で見出し非表示。 */
  show_heading?: boolean;
  /** PR-PZ2.1: 表示する問題の範囲。
   *  "all"→全問題 / "delivered"→到達済み（既定・従来挙動）/ "solved"→正解済みのみ。 */
  display_mode?: "all" | "delivered" | "solved";
}

/**
 * accordion ブロック設定。
 * children には任意の AnyLiffBlockSettings を含むネスト可能なブロックを格納する。
 * ネストは最大 3 階層に制限する（バリデーション側で担保）。
 */
export interface AccordionSettings {
  title?: string;
  default_open?: boolean;
  variant?: LiffSectionVariant;
  children?: NestedLiffBlock[];
}

/** コードリーダー（QR読み取り）ブロック設定。
 *  実機では liff.scanCodeV2() で読み取り、location_checkin の場合は既存のチェックイン導線
 *  (/liff?work_id=..&location_id=..) へ接続する。プレビューではカメラを起動せずプレースホルダ表示。 */
export interface CodeReaderSettings {
  /** 行に表示するラベル（デフォルト「チェックインする」） */
  label?: string;
  /** モーダル（ボトムシート）タイトル（デフォルト「コードリーダー」） */
  modal_title?: string;
  /** 任意の説明文 */
  description?: string;
  /** 読み取り後の動作。location_checkin = 既存チェックイン導線へ / show_result = 値を表示のみ */
  after_scan?: "location_checkin" | "show_result";
}

/** チェックイン履歴ブロック設定。
 *  プレイヤー本人のチェックイン履歴（地点名 / 日時 / 種別）を LIFF 内の任意位置に表示する。
 *  既存の location ページ種別と同じ API・ロジック（LocationHistoryRenderer）を再利用する。
 *  X API / スクレイピングは使わない（自前のチェックイン記録のみ）。 */
export interface CheckinHistorySettings {
  /** 見出し（未設定なら見出しを表示しない）。 */
  title?: string;
  /** 補足説明文（任意）。 */
  description?: string;
  /** 最大表示件数（未設定は全件）。 */
  max_count?: number;
}

/** accordion の中に直接埋め込めるネスト可能ブロック（DBには載らないインライン構造） */
export interface NestedLiffBlock {
  /** 子要素の安定 ID（クライアントで生成・保存） */
  id?: string;
  block_type: LiffBlockType;
  title?: string | null;
  settings_json?: AnyLiffBlockSettings;
}

export type AnyLiffBlockSettings =
  | FreeTextSettings
  | StartButtonSettings
  | ResumeButtonSettings
  | ProgressSettings
  | EvidenceListSettings
  | HintListSettings
  | CharacterListSettings
  | ImageBlockSettings
  | VideoBlockSettings
  | HeadingSettings
  | TextSettings
  | WarningSettings
  | ButtonLinkSettings
  | DividerSettings
  | AccordionSettings
  | CodeReaderSettings
  | CheckinHistorySettings;

export type LiffBlockSettings = AnyLiffBlockSettings;

export interface LiffPageBlock {
  id:                        string;
  page_config_id:            string;
  block_type:                LiffBlockType;
  sort_order:                number;
  is_enabled:                boolean;
  title:                     string | null;
  settings_json:             LiffBlockSettings;
  visibility_condition_json: VisibilityCondition | null;
  created_at:                string;
  updated_at:                string;
}

/**
 * LIFF ページ全体の設定。
 *
 * ヒントサイト機能ではヘッダー（ロゴ・CTA）やテーマ設定などをここに格納する。
 * 既存の LiffPageConfig を壊さないように、すべての項目はオプショナル。
 */
/** @deprecated `font_preset` を使ってください。
 *  旧仕様: gothic / mincho の 2 択。読み込み時に font_preset へマップする。
 *    - "gothic" → "line_seed_jp"
 *    - "mincho" → "serif"
 *  既存データ互換のため型と field は残置。新規 CMS では非表示。 */
export type LiffFontFamily = "gothic" | "mincho";

/** ページ全体のフォントプリセット (LINE ギフト風の自然な表示に寄せる)。
 *
 *  - "line_seed_jp": LINE Seed JP (既定、LINE 公式アカウント内 LIFF のデフォルト)
 *  - "system_sans" : OS のシステムフォント (San Francisco / Roboto / Noto Sans CJK)
 *  - "noto_sans_jp": Google Noto Sans JP (静かなゴシック)
 *  - "serif"       : Noto Serif JP / 游明朝 / ヒラギノ明朝 (上品な明朝)
 *
 *  未指定 / 不正値は renderer 側で "line_seed_jp" として扱う。
 *  旧 `font_family` がある場合は gothic→line_seed_jp / mincho→serif にマップ。 */
export type LiffFontPreset = "line_seed_jp" | "system_sans" | "noto_sans_jp" | "serif";

/** 本文 description の配置 (左/中央/右)。
 *  未指定 / 不正値は renderer 側で "center" として扱う (LINE Design System 既定)。 */
export type LiffDescriptionAlign = "left" | "center" | "right";

export interface LiffPageConfigSettings {
  /** ページ全体のフォントプリセット。未指定は "line_seed_jp"。 */
  font_preset?: LiffFontPreset;
  /** @deprecated 旧仕様。新規データでは font_preset を使う。読み込み時のフォールバック用に残置。 */
  font_family?: LiffFontFamily;
  /** LIFF プレイヤー画面の上部ヘッダーに表示する文言。
   *  例: "チェックイン" / "設定資料" / "ご案内" / "出演者A" / "公演情報"
   *  未指定は work.title にフォールバックする (renderer 側で処理)。 */
  header_title?: string;
  /** 本文 description の配置。未指定は "center"。 */
  description_align?: LiffDescriptionAlign;
  /** 固定ヘッダーを使用するか（hint_site のとき有効） */
  header_fixed?: boolean;
  /** ロゴ画像 URL（枠内に contain で表示される） */
  header_logo_url?: string;
  /** ロゴの alt テキスト */
  header_logo_alt?: string;
  /** CTA ボタンのラベル（例: "チケットを購入する"） */
  header_cta_label?: string;
  /** CTA ボタンの URL */
  header_cta_url?: string;
  /** ハンバーガーメニューを表示するか（将来の拡張用。現状は枠のみ確保） */
  show_hamburger?: boolean;
  /** 本文上部に表示するネタバレ注意帯のテキスト */
  spoiler_warning_text?: string;
  /** テーマ設定 */
  theme?: {
    /** ヘッダー背景色（CSS color 文字列） */
    header_bg?: string;
    /** ヘッダー文字色 */
    header_fg?: string;
    /** デフォルト variant 色のオーバーライド */
    variants?: {
      default?: { bg?: string; fg?: string; border?: string };
      dark?:    { bg?: string; fg?: string; border?: string };
      purple?:  { bg?: string; fg?: string; border?: string };
    };
  };

  // ── シェアボタン設定（全モード共通） ───────
  /** シェアボタンを表示するか */
  share_enabled?: boolean;
  /** シェアボタンのラベル文言（未設定時はデフォルト "友だちにシェアする"） */
  share_button_label?: string;
  /** シェアメッセージ（未設定時はページタイトル + 現在 URL を使う） */
  share_message?: string;

  // ── 謎・問題 (puzzle) モード設定 [PR-PZ2.1] ──
  // RiddleListSettings と同じキー。puzzle ページの settings_json に保存し PuzzleRenderer → RiddleListBlock へ渡す。
  /** 一覧見出しの表示名モード（"riddle"→謎 / "question"→問題 / "custom"→自由入力）。 */
  heading_mode?: "riddle" | "question" | "custom";
  /** heading_mode="custom" のときの自由入力見出し。 */
  heading_custom?: string;
  /** 一覧見出し（h3）を表示するか（既定 true）。 */
  show_heading?: boolean;
  /** 表示する問題の範囲（"all" / "delivered"(既定) / "solved"）。 */
  display_mode?: "all" | "delivered" | "solved";
  /** 状態ラベル（正解済み / 未回答）を表示するか（既定 true）。 */
  show_status?: boolean;
  /** 最大表示件数（未設定は全件）。 */
  max_count?: number;

  // ── FAQ モード設定 ──────────────────────────
  /** FAQ モードの Q&A 項目。順序は配列順。空項目はプレイヤー側で非表示。 */
  faq_items?: FaqItem[];

  // ── Survey モード設定 ───────────────────────
  /** Survey モードの質問項目。順序は配列順。 */
  survey_items?: SurveyItem[];
  /** Survey 送信完了時に表示するテキスト */
  survey_thanks_message?: string;

  // ── Contact（お問い合わせ）モード設定 ───────────────────────
  //   すべて任意。未設定でも安全に動く（resolveContactConfig が既定値を補う）。
  /** 問い合わせ種別の選択肢。空配列/未設定なら種別欄を表示しない。 */
  contact_categories?: string[];
  /** 種別を必須にするか（既定: true）。 */
  contact_category_required?: boolean;
  /** お名前欄を表示するか（既定: true）。 */
  contact_show_name?: boolean;
  /** お名前を必須にするか（既定: false）。 */
  contact_name_required?: boolean;
  /** メール欄を表示するか（既定: true）。 */
  contact_show_email?: boolean;
  /** メールを必須にするか（既定: false）。 */
  contact_email_required?: boolean;
  /** お問い合わせ内容（本文・最大100文字）を必須にするか（既定: true）。 */
  contact_body_required?: boolean;
  /** その他項目（SurveyItem 流用: text/textarea/radio/checkbox）。 */
  contact_custom_fields?: SurveyItem[];
  /** 送信完了時に表示するテキスト（未設定は標準文言）。 */
  contact_success_message?: string;

  // ── 作品メニュー shell (タブ UI) 用設定 (deprecated) ────────
  /** @deprecated PR #59 のタブ UI 用。`/liff/w/[workPublicId]` がメニューホーム +
   *  個別ページ構成に変わったため、現行 renderer はこのフィールドを参照しない。
   *  既存データを壊さないため schema には残置。新規データでは `show_in_menu` を使う。 */
  tab_enabled?: boolean;
  /** @deprecated PR #59 のタブ UI 用。新規データでは `menu_label` を使う。 */
  tab_label?: string;
  /** @deprecated PR #59 のタブ UI 用。本文タイトルは LIFF ページの `title` で代替する。 */
  tab_page_title?: string;

  // ── 作品メニューホーム (グリッドカード) 用設定 ──────
  // このページが /liff/w/[workPublicId] のメニューホームでカードとして並ぶ際の振る舞い。
  // 個別ページ (/liff/w/[workPublicId]/p/[pagePublicId]) の表示自体はここでは制御しない
  // (= 個別 URL を直接開けば、`show_in_menu=false` でも表示される)。
  /** このページをメニューホームのカードとして並べるか。未指定 = true (表示)。
   *  false にしてもページ自体は公開されたまま (URL 直アクセスは生きる)。 */
  show_in_menu?: boolean;
  /** メニューホームのカードに出す文言。未指定なら `title` → pageType 既定名にフォールバック。 */
  menu_label?: string;
  /** メニューホームのカードに出すアイコン (emoji を想定。1〜3 文字程度)。
   *  未指定なら pageType 別の既定 emoji にフォールバック。 */
  menu_icon?: string;
  /** メニューホームのアイコン画像 URL（任意）。設定時は emoji より優先して画像を表示する。
   *  未設定（空文字/未指定）なら従来表示（emoji / 既定アイコン）にフォールバック。 */
  menu_icon_image_url?: string;
  /** メニューホームでのカード並び順 (小さい順)。同値は createdAt asc。
   *  未指定はもっとも後ろに回す。 */
  menu_order?: number;
  /** メニューホームでのカード表示形式。
   *  - "card"    : 2 列グリッドの通常カード (既定)
   *  - "compact" : 横長 1 行の省スペース表示 (アイコン左・説明省略)
   *  未指定 = "card" 扱い (= 既存ページの表示は変わらない)。 */
  menu_card_style?: "card" | "compact";

  /** LIFF プレイヤー画面最下部の "Powered by Whale Studio" クレジット表記の表示有無。
   *  未指定 = true (= 表示)。false で非表示 (ホワイトラベル運用想定)。
   *  per-page で持っているが、運用上は work 配下の全ページで揃える想定。 */
  show_whale_studio_credit?: boolean;
}

/** FAQ 1 項目 */
export interface FaqItem {
  /** クライアントで生成する安定 ID（並び替え時のキー） */
  id?: string;
  question: string;
  answer:   string;
}

/** Survey 入力種別 */
export type SurveyInputType = "text" | "textarea" | "radio" | "checkbox";

/** Survey 1 質問 */
export interface SurveyItem {
  id?: string;
  question:    string;
  input_type:  SurveyInputType;
  /** radio / checkbox 用の選択肢 */
  options?:    string[];
  /** 必須入力か */
  required?:   boolean;
}

export interface LiffPageConfig {
  id:              string;
  /** 公開 URL 用の短縮 ID (10 文字)。CMS 管理画面の「実機で確認する」欄など、URL 生成時に使う。 */
  public_id?:      string;
  work_id:         string;
  /** Work の公開 URL 用短縮 ID。LIFF プレイヤー URL 生成時に使う。 */
  work_public_id?: string;
  is_enabled:      boolean;
  title:           string | null;
  description:     string | null;
  page_type:       LiffPageType;
  publish_status:  LiffPublishStatus;
  settings_json:   LiffPageConfigSettings;
  blocks:          LiffPageBlock[];
  created_at:      string;
  updated_at:      string;
}

export interface UpdateLiffConfigBody {
  is_enabled?:     boolean;
  title?:          string | null;
  description?:    string | null;
  page_type?:      LiffPageType;
  publish_status?: LiffPublishStatus;
  settings_json?:  LiffPageConfigSettings;
}

export interface CreateLiffBlockBody {
  block_type:                LiffBlockType;
  sort_order?:               number;
  is_enabled?:               boolean;
  title?:                    string | null;
  settings_json?:            LiffBlockSettings;
  visibility_condition_json?: VisibilityCondition | null;
}

export interface UpdateLiffBlockBody {
  block_type?:               LiffBlockType;
  sort_order?:               number;
  is_enabled?:               boolean;
  title?:                    string | null;
  settings_json?:            LiffBlockSettings;
  visibility_condition_json?: VisibilityCondition | null;
}

export interface ReorderLiffBlocksBody {
  block_ids: string[];
}

/** 一括保存（ページ設定 + ブロック全件）リクエスト内の 1 ブロック。
 *  id: 既存ブロックは server の UUID。新規ブロックは未指定（または temp- 始まりのローカル ID）。 */
export interface BulkSaveLiffBlockBody {
  id?:                        string;
  block_type:                 LiffBlockType;
  title?:                     string | null;
  is_enabled?:                boolean;
  settings_json?:             LiffBlockSettings;
  visibility_condition_json?: VisibilityCondition | null;
}

/** 一括保存リクエスト。blocks は「保存後にこのページに存在すべき全ブロック」を並び順で渡す。
 *  サーバーは差分で create/update/delete し、配列の index を sort_order に採用する。 */
export interface BulkSaveLiffPageBody {
  is_enabled?:     boolean;
  title?:          string | null;
  description?:    string | null;
  page_type?:      LiffPageType;
  publish_status?: LiffPublishStatus;
  settings_json?:  LiffPageConfigSettings;
  blocks:          BulkSaveLiffBlockBody[];
}

// ────────────────────────────────────────────────
// 人狼 / 配役閲覧モード — pageType="werewolf" 配下のデータ
// (DB テーブル: werewolf_titles / werewolf_role_slots / werewolf_role_cards)
// ────────────────────────────────────────────────

/** 1 ゲーム単位。LiffPageConfig(pageType="werewolf") 配下に複数並ぶ。 */
export interface WerewolfTitle {
  id:                  string;
  public_id?:          string;
  liff_page_config_id: string;
  work_id:             string;
  title:               string;
  description:         string | null;
  /** プレイ予定日時 (ISO 文字列、null 可)。 */
  scheduled_at:        string | null;
  player_count:        number;
  is_started:          boolean;
  started_at:          string | null;
  sort_order:          number;
  created_at:          string;
  updated_at:          string;
  /** GM 詳細画面ではここに slots を埋めて返す。一覧では空 or 省略。 */
  slots?:              WerewolfRoleSlot[];
}

/** 1 タイトル内の 1 プレイヤー分のスロット。QR の単位。 */
export interface WerewolfRoleSlot {
  id:           string;
  title_id:     string;
  slot_number:  number;
  /** GM 用管理ラベル (プレイヤーには非表示) */
  label:        string | null;
  /** QR / URL に使う opaque な短縮トークン (10 文字) */
  token:        string;
  created_at:   string;
  updated_at:   string;
  /** GM 詳細 / プレイヤー閲覧時はここに cards を埋めて返す。 */
  cards?:       WerewolfRoleCard[];
}

/** 1 slot に並ぶ配役カード (役職カード / アイテムカード等)。 */
export interface WerewolfRoleCard {
  id:           string;
  slot_id:      string;
  title:        string;
  subtitle:     string | null;
  badge_label:  string | null;
  body:         string;
  sort_order:   number;
  created_at:   string;
  updated_at:   string;
}

// ── リクエストボディ ──
export interface CreateWerewolfTitleBody {
  liff_page_config_id: string;
  title:               string;
  description?:        string | null;
  /** ISO 文字列 (例: "2026-11-15T00:00:00+09:00")。null 可。 */
  scheduled_at?:       string | null;
  /** 0 以上。POST 時、この数だけ slot が auto-generate される。 */
  player_count:        number;
}

/** タイトル更新 body。player_count を増やすと slot を auto-extend、減らすと末尾を削除する。 */
export interface UpdateWerewolfTitleBody {
  title?:        string;
  description?:  string | null;
  scheduled_at?: string | null;
  player_count?: number;
}

/** スロット更新 body。token は別 endpoint (rotate-token) で再発行する。 */
export interface UpdateWerewolfRoleSlotBody {
  label?: string | null;
}

/** 配役カード新規作成 body。 */
export interface CreateWerewolfRoleCardBody {
  title:        string;
  subtitle?:    string | null;
  badge_label?: string | null;
  body:         string;
}

/** 配役カード更新 body。全フィールド optional (部分更新)。 */
export interface UpdateWerewolfRoleCardBody {
  title?:       string;
  subtitle?:    string | null;
  badge_label?: string | null;
  body?:        string;
}

/** カード並び替え body — slot 配下のカード id 順を指定する。 */
export interface ReorderWerewolfRoleCardsBody {
  card_ids: string[];
}

/** プレイヤー側 (LIFF) `/api/liff/werewolf/slots/[slotToken]` のレスポンス。
 *  is_started=false のときは cards を返さない (サーバー側 gating)。 */
export interface PlayerWerewolfRoleSlot {
  slot_token:  string;
  slot_number: number;
  title:       string;
  description: string | null;
  scheduled_at: string | null;
  is_started:  boolean;
  /** is_started=true のときだけ詰める。false なら空配列 or 未指定。 */
  cards:       WerewolfRoleCard[];
}

// ────────────────────────────────────────────────
// Location — ビーコン / QR チェックインポイント
// ────────────────────────────────────────────────
export type CheckinMode = "qr_only" | "gps_only" | "qr_and_gps";
export type CheckinMethod = "qr" | "gps" | "qr_and_gps" | "beacon";

export interface Location {
  id:               string;
  /** 公開 URL 用の短縮 ID。チェックイン URL で使う */
  public_id?:       string;
  work_id:          string;
  name:             string;
  description:      string | null;
  beacon_uuid:      string | null;
  beacon_major:     number | null;
  beacon_minor:     number | null;
  latitude:         number | null;
  longitude:        number | null;
  radius_meters:    number | null;
  /** @deprecated checkin_mode から導出される。将来削除予定。requiresGps(checkin_mode) を使用。 */
  gps_enabled:      boolean;
  checkin_mode:     CheckinMode;
  cooldown_seconds: number;
  transition_id:    string | null;
  /** QR 読み取り成功時に LINE push 送信するメッセージ ID（null = 未設定）。 */
  qr_success_message_id: string | null;
  set_flags:        string;
  sort_order:       number;
  is_active:        boolean;
  stamp_enabled:    boolean;
  stamp_label:      string | null;
  stamp_order:      number | null;
  created_at:       string;
  updated_at:       string;
}

export interface LocationWithTransition extends Location {
  transition: {
    id:    string;
    label: string;
    to_phase: { id: string; name: string; phase_type: string } | null;
  } | null;
}

export interface LocationVisit {
  id:              string;
  line_user_id:    string;
  location_id:     string;
  work_id:         string;
  checkin_method:  CheckinMethod;
  distance_meters: number | null;
  visited_at:      string;
}

// ── Location リクエストボディ ──
export interface CreateLocationBody {
  work_id:          string;
  name:             string;
  description?:     string;
  beacon_uuid?:     string;
  beacon_major?:    number;
  beacon_minor?:    number;
  latitude?:        number;
  longitude?:       number;
  radius_meters?:   number;
  /** @deprecated checkin_mode から自動設定。送信不要。 */
  gps_enabled?:     boolean;
  checkin_mode?:    CheckinMode;
  cooldown_seconds?: number;
  transition_id?:   string;
  qr_success_message_id?: string | null;
  set_flags?:       string;
  sort_order?:      number;
  is_active?:       boolean;
  stamp_enabled?:   boolean;
  stamp_label?:     string;
  stamp_order?:     number;
}

export interface UpdateLocationBody {
  name?:             string;
  description?:      string | null;
  beacon_uuid?:      string | null;
  beacon_major?:     number | null;
  beacon_minor?:     number | null;
  latitude?:         number | null;
  longitude?:        number | null;
  radius_meters?:    number | null;
  /** @deprecated checkin_mode から自動設定。送信不要。 */
  gps_enabled?:      boolean;
  checkin_mode?:     CheckinMode;
  cooldown_seconds?: number;
  transition_id?:    string | null;
  qr_success_message_id?: string | null;
  set_flags?:        string;
  sort_order?:       number;
  is_active?:        boolean;
  stamp_enabled?:    boolean;
  stamp_label?:      string | null;
  stamp_order?:      number | null;
}

// ────────────────────────────────────────────────
// LineDestination — 再利用可能な遷移先URL定義
// ────────────────────────────────────────────────

export type DestinationType = "liff" | "internal_url" | "external_url";
export type LiffTargetType = "work_main" | "custom";

export interface LineDestination {
  id:                string;
  work_id:           string;
  key:               string;
  name:              string;
  description:       string | null;
  destination_type:  DestinationType;
  liff_target_type:  LiffTargetType | null;
  url_or_path:       string | null;
  query_params_json: Record<string, string>;
  is_enabled:        boolean;
  created_at:        string;
  updated_at:        string;
  /** API 側で計算された解決済みURL */
  resolved_url?:     string | null;
  /** 使用箇所の件数（一覧API で返される） */
  usage_count?:      number;
}

export interface CreateLineDestinationBody {
  work_id:            string;
  key:                string;
  name:               string;
  description?:       string | null;
  destination_type:   DestinationType;
  liff_target_type?:  LiffTargetType | null;
  url_or_path?:       string | null;
  query_params_json?: Record<string, string>;
  is_enabled?:        boolean;
}

export interface UpdateLineDestinationBody {
  key?:               string;
  name?:              string;
  description?:       string | null;
  destination_type?:  DestinationType;
  liff_target_type?:  LiffTargetType | null;
  url_or_path?:       string | null;
  query_params_json?: Record<string, string>;
  is_enabled?:        boolean;
}

// ── LIFF チェックイン ──
export interface CheckinRequest {
  line_user_id:    string;
  location_id:     string;
  work_id:         string;
  checkin_method?: CheckinMethod;
  lat?:            number;
  lng?:            number;
}

/** チェックイン成功 */
export interface CheckinSuccess {
  success:     true;
  status:      "checked_in";
  location_id: string;
  work_id:     string;
  location_name: string;
  checkin_method: CheckinMethod;
  message:     string;
  cooldown_remaining_seconds: 0;
  distance_meters?: number;
  radius_meters?:   number;
  transition?: { id: string; name: string; phase_type: string };
  flags_applied?: Record<string, unknown>;
  stamp?: StampInfo;
}

/** クールダウン中 */
export interface CheckinCooldown {
  success:     true;
  status:      "cooldown";
  location_id: string;
  work_id:     string;
  location_name: string;
  checkin_method: CheckinMethod;
  message:     string;
  cooldown_remaining_seconds: number;
}

/** GPS 範囲外 */
export interface CheckinOutOfRange {
  success:     false;
  status:      "out_of_range";
  location_id: string;
  work_id:     string;
  location_name: string;
  message:     string;
  distance_meters: number;
  radius_meters:   number;
}

/** チェックインレスポンス（判別共用体） */
export type CheckinResult = CheckinSuccess | CheckinCooldown | CheckinOutOfRange;

/** スタンプ情報（checkin レスポンスに含まれる） */
export interface StampInfo {
  enabled:         boolean;
  newly_collected: boolean;
  completed_count: number;
  total_count:     number;
  is_completed:    boolean;
}

/** スタンプラリー進捗 */
export interface StampRallyProgress {
  work_id:         string;
  total_count:     number;
  completed_count: number;
  is_completed:    boolean;
  locations: Array<{
    location_id:  string;
    name:         string;
    stamp_label:  string;
    order:        number | null;
    checked_in:   boolean;
    checked_in_at?: string;
  }>;
}

// ── LocationVisit 集計 ──

export interface CheckinMethodBreakdown {
  qr_count:          number;
  gps_count:         number;
  qr_and_gps_count:  number;
}

export interface GpsDistanceStats {
  sample_count:        number;
  avg_distance_meters: number;
  min_distance_meters: number;
  max_distance_meters: number;
}

export interface LocationVisitSummary {
  location_id:          string;
  location_name:        string;
  total_visits:         number;
  unique_users:         number;
  qr_count:             number;
  gps_count:            number;
  qr_and_gps_count:     number;
  avg_distance_meters:  number | null;
  gps_attempts:         number;
  gps_successes:        number;
  gps_success_rate:     number | null;
  out_of_range_count:   number;
  radius_suggestion:    RadiusSuggestionResult | null;
  last_visited_at:      string | null;
}

/** 半径見直し提案 */
export interface RadiusSuggestionResult {
  current_radius:   number;
  suggested_radius: number;
  reason:           string;
  confidence:       "high" | "medium" | "low";
  sample_count:     number;
}

/** GPS 試行の失敗理由内訳 */
export interface GpsFailureBreakdown {
  out_of_range:              number;
  permission_denied:         number;
  gps_unavailable:           number;
  invalid_request:           number;
  location_not_supported:    number;
  location_config_incomplete: number;
}

/** GPS 試行全体の統計 */
export interface GpsAttemptStats {
  total_attempts:   number;
  successes:        number;
  failures:         number;
  success_rate:     number | null;
  failure_breakdown: GpsFailureBreakdown;
}

export interface LocationVisitStats {
  total_checkins:     number;
  unique_users:       number;
  location_count:     number;
  recent_7d_checkins: number;
  method_breakdown:   CheckinMethodBreakdown;
  gps_distance:       GpsDistanceStats | null;
  gps_attempts:       GpsAttemptStats;
  by_location:        LocationVisitSummary[];
}

/** チェックイン試行ログ送信用（クライアント → API） */
export interface CheckinAttemptLogRequest {
  work_id:     string;
  location_id: string;
  line_user_id: string;
  method:      string;
  status:      string;
  failure_reason?: string;
  lat?:        number;
  lng?:        number;
}

// ── X投稿管理（X posts）──────────────────────────────
export type XPostStatus = "draft" | "scheduled" | "posted" | "archived";

export interface XPost {
  id: string;
  oa_id: string;
  work_id: string;
  title: string | null;
  body: string | null;
  hashtags: string[];
  image_url: string | null;
  uploaded_image_url: string | null;
  link_url: string | null;
  utm_enabled: boolean;
  utm_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  generated_url: string | null;
  tracking_code: string | null;
  tracking_url: string | null;
  x_post_url: string | null;
  status: XPostStatus;
  note: string | null;
  posted_at: string | null;
  scheduled_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** 流入分析（PR2）。PR1 では計測URLクリック数を集計して返す。 */
  click_count: number;
  unique_click_count: number;
}

export interface CreateXPostBody {
  title?: string | null;
  body?: string | null;
  hashtags?: string[] | null;
  image_url?: string | null;
  uploaded_image_url?: string | null;
  link_url?: string | null;
  utm_enabled?: boolean;
  utm_name?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  generated_url?: string | null;
  x_post_url?: string | null;
  status?: XPostStatus;
  note?: string | null;
  posted_at?: string | null;
  scheduled_at?: string | null;
  sort_order?: number;
}
export type UpdateXPostBody = CreateXPostBody;

// ── X投稿 流入分析（PR2）──────────────────────────────
export interface XPostAnalyticsRow {
  id: string;
  title: string | null;
  body_excerpt: string;
  x_post_url: string | null;
  tracking_url: string | null;
  hashtags: string[];
  click_count: number;
  unique_click_count: number;
  cv_count: number;
  /** CV / clicks。クリック0は null（UIで「-」） */
  cvr: number | null;
  last_clicked_at: string | null;
}
export interface XPostAnalytics {
  summary: {
    post_count: number;
    tracking_issued_count: number;
    total_clicks: number;
    total_unique_clicks: number;
    total_cv: number;
    avg_cvr: number | null;
    last_clicked_at: string | null;
  };
  rows: XPostAnalyticsRow[];
  ranking: { rank: number; id: string; title: string | null; cvr: number | null; cv_count: number; click_count: number }[];
}

// ── X投稿 感情分析（PR3）──────────────────────────────
export interface XSentimentMetricRow {
  id: string; post_title: string | null; x_post_url: string | null; posted_at: string | null;
  impressions: number; csv_url_clicks: number; csv_url_click_rate: number | null;
  ws_click_count: number; cv_count: number; impression_cvr: number | null;
  likes: number; reposts: number; replies: number; quotes: number; bookmarks: number;
  imported_at: string;
}
export interface XSentimentMentionRow {
  id: string; posted_at: string | null; text: string; url: string | null;
  related_x_post_url: string | null; sentiment: string; repeat_intent: string;
  source: string | null; imported_at: string;
}
export interface XPostSentiment {
  summary: {
    mention_count: number; analyzed_count: number;
    positive_rate: number | null; negative_rate: number | null; repeat_high_rate: number | null;
    last_imported_at: string | null; last_analyzed_at: string | null;
    metric_count: number; total_impressions: number; avg_impressions: number;
    csv_url_click_rate: number | null; impression_cvr: number | null;
  };
  metric_rows: XSentimentMetricRow[];
  mention_rows: XSentimentMentionRow[];
  frequent_words: { word: string; count: number; mentionCount: number }[];
  sentiment_counts: { positive: number; neutral: number; negative: number; unknown: number };
  repeat_counts: { high: number; medium: number; low: number; unknown: number };
  representative: { positive: string[]; negative: string[]; repeat_high: string[] };
  repeat_high_ranking: { expr: string; count: number }[];
}
