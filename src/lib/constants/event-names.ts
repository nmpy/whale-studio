// src/lib/constants/event-names.ts
// event_logs テーブルに記録するイベント名の定数・ペイロード型定義。
//
// イベント一覧:
//   screen_view        — ページ表示
//   flow_step          — 主要導線ステップ到達
//   onboarding_blocked — 初回セットアップで詰まったとき
//   upgrade_interest   — pricing閲覧・ゲート表示・CTAクリック
//   error              — API失敗・バリデーションエラー
//   action_success     — 作品/メッセージ/キャラ作成など成功操作
//   hub_action_click   — 作品ハブの主要アクション行クリック

// ── イベント名 ────────────────────────────────────────────────────────────
export const EVENT_NAMES = [
  "screen_view",
  "flow_step",
  "onboarding_blocked",
  "upgrade_interest",
  "error",
  "action_success",
  "hub_action_click",
  // ── 再開導線計測（途中離脱ユーザーの再開 UX）──
  "resume_choice_shown",    // 「途中から再開する / 最初からやり直す」選択肢を提示したとき
  "resume_choice_selected", // ユーザーがいずれかを選択したとき
  "resume_completed",       // 再開ユーザーがエンディングに到達したとき
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

// ── ペイロード型（イベント名ごと） ────────────────────────────────────────

/** ページ表示 */
export interface ScreenViewPayload {
  /** フルパス（例: "/pricing", "/oas/[id]/works"） */
  page:    string;
  /** ページタイトル（任意） */
  title?:  string;
}

/** 主要導線ステップ到達 */
export interface FlowStepPayload {
  /** ステップ名（例: "works" | "hub" | "pricing" | "gate" | "message_edit"） */
  step:    string;
  /** 流入元（例: "header" | "gate" | "direct" | "banner"） */
  source?: string;
  /** 作品 ID（任意） */
  work_id?: string;
}

/** 初回セットアップで詰まったとき */
export interface OnboardingBlockedPayload {
  /** 詰まったステップ（例: "character" | "phase" | "message" | "transition"） */
  step:    string;
  /** 詰まった理由（例: "setup_incomplete" | "no_characters"） */
  reason:  string;
  /** 作品 ID（任意） */
  work_id?: string;
}

/** pricing閲覧・ゲート/バナー表示・CTAクリック */
export interface UpgradeInterestPayload {
  /** アクション種別 */
  action:  "view" | "cta_click" | "gate_shown" | "banner_shown" | "stripe_checkout_start";
  /** 流入元（例: "header" | "gate" | "banner" | "preview"） */
  source?: string;
  /** 遷移元プラン名（例: "tester"）*/
  from?:   string;
  /** 遷移先プラン名（例: "editor"）*/
  to?:     string;
}

/** API失敗・バリデーションエラー */
export interface ErrorPayload {
  /** エラーメッセージ */
  message:  string;
  /** エラーコード（任意） */
  code?:    string;
  /** 発生コンテキスト（例: "work_create" | "message_save"） */
  context?: string;
}

/** 成功操作 */
export interface ActionSuccessPayload {
  /** 操作名（例: "work_created" | "message_created" | "character_created"） */
  action:    string;
  /** 作品 ID（任意） */
  work_id?:  string;
  /** 追加情報（任意） */
  detail?:   Record<string, unknown>;
}

// ── hub_action_click 専用型 ───────────────────────────────────────────────
//
// 分析用途（このイベントで知りたいこと）:
//   1. どのアクションキーが最も押されるか（messages / scenario / preview / ...）
//   2. emphasis="warning" 付与時に scenario / audience の CTR が上がるか
//      → Rule5（inProgress>0 && completed=0）の施策効果を検証
//   3. players=0 のとき preview を上位に出す判断の効果検証
//      → preview の position_index と CTR の相関を見る
//   4. status="active" 時に audience を上げた効果の検証
//   5. 作品状態（status / hasTrigger）ごとのアクションパターン把握

/** 作品ハブ 主要アクション行のクリック計測ペイロード */
export interface HubActionClickPayload {
  // ── 操作識別 ──────────────────────────────────────────────────
  /** クリックされたアクションキー */
  action_key:        "messages" | "scenario" | "preview" | "characters" | "audience";
  /** クリック時点の強調トーン（resolveActions が付与したもの） */
  emphasis:          "preview" | "warning" | "normal";
  /** 表示上の左からの位置（0 始まり）— CTR と順序の関係を分析するために使う */
  position_index:    number;
  /** 計測元の UI 識別子（将来 hub 以外に同パターンを展開した際の区別用） */
  source:            "work_hub_primary_actions";

  // ── 作品状態スナップショット（クリック時点の状態を記録） ──────
  // resolveActions のルール効果を後から分析するため、
  // 入力パラメータを全てそのまま保存する
  /** 公開ステータス（draft / active / paused） */
  status:            string;
  /** 開始トリガーが設定されているか */
  has_start_trigger: boolean;
  /** 総プレイヤー数 */
  players:           number;
  /** 完了ユーザー数 */
  completed:         number;
  /** 進行中ユーザー数 */
  in_progress:       number;
  /** 作品 ID（oa_id は event-tracker の opts で渡す） */
  work_id:           string;
}

// ── 再開導線 専用型 ────────────────────────────────────────────────────────
//
// 計測用途:
//   1. 何人が再開選択肢を見たか（resume_choice_shown）
//   2. 再開 vs やり直しの選択割合（resume_choice_selected）
//   3. 再開後の完走率（resume_completed / resume_choice_selected[mode=resume]）

/** 再開選択肢（途中から / やり直し）を表示したときのペイロード */
export interface ResumeChoiceShownPayload {
  /** 対象作品 ID */
  work_id:             string;
  /** 途中離脱していたフェーズ ID */
  current_phase_id:    string;
  /** 該当フェーズに resumeSummary（再開時あらすじ）が設定されているか */
  has_resume_summary:  boolean;
}

/** ユーザーが選択肢をタップしたときのペイロード */
export interface ResumeChoiceSelectedPayload {
  /** 対象作品 ID */
  work_id:             string;
  /** 途中離脱していたフェーズ ID */
  current_phase_id:    string;
  /** ユーザーが選んだモード */
  mode:                "resume" | "restart";
  /** 該当フェーズに resumeSummary（再開時あらすじ）が設定されているか */
  has_resume_summary:  boolean;
}

/** 再開ユーザーがエンディングに到達したときのペイロード */
export interface ResumeCompletedPayload {
  /** 対象作品 ID */
  work_id:               string;
  /** 再開時に起点となったフェーズ ID */
  resumed_from_phase_id: string;
  /** 該当フェーズに resumeSummary が設定されていたか（summary効果の完走率計測に使用） */
  has_resume_summary:    boolean;
}

/** イベント名 → ペイロード型のマッピング */
export type EventPayloadMap = {
  screen_view:             ScreenViewPayload;
  flow_step:               FlowStepPayload;
  onboarding_blocked:      OnboardingBlockedPayload;
  upgrade_interest:        UpgradeInterestPayload;
  error:                   ErrorPayload;
  action_success:          ActionSuccessPayload;
  hub_action_click:        HubActionClickPayload;
  resume_choice_shown:     ResumeChoiceShownPayload;
  resume_choice_selected:  ResumeChoiceSelectedPayload;
  resume_completed:        ResumeCompletedPayload;
};
