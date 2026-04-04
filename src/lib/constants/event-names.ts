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

// ── イベント名 ────────────────────────────────────────────────────────────
export const EVENT_NAMES = [
  "screen_view",
  "flow_step",
  "onboarding_blocked",
  "upgrade_interest",
  "error",
  "action_success",
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
  action:  "view" | "cta_click" | "gate_shown" | "banner_shown";
  /** 流入元（例: "header" | "gate" | "banner" | "preview"） */
  source?: string;
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

/** イベント名 → ペイロード型のマッピング */
export type EventPayloadMap = {
  screen_view:        ScreenViewPayload;
  flow_step:          FlowStepPayload;
  onboarding_blocked: OnboardingBlockedPayload;
  upgrade_interest:   UpgradeInterestPayload;
  error:              ErrorPayload;
  action_success:     ActionSuccessPayload;
};
