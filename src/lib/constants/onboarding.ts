// src/lib/constants/onboarding.ts
// オンボーディングステップ定義

export const ONBOARDING_STEPS = [
  "work_created",
  "character_created",
  "phase_created",
  "message_created",
  "flow_connected",
  "previewed",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** UI 表示用ラベル */
export const ONBOARDING_STEP_LABELS = {
  work_created:      "作品作成",
  character_created: "キャラクター作成",
  phase_created:     "フェーズ作成",
  message_created:   "メッセージ・謎追加",
  flow_connected:    "シナリオフロー設定",
  previewed:         "プレビュー確認",
} as const;

/** UI 表示用説明 */
export const ONBOARDING_STEP_DESCS: Record<OnboardingStep, string> = {
  work_created:      "作品を1件以上作成した",
  character_created: "キャラクターを1体以上作成した",
  phase_created:     "フェーズを1件以上作成した",
  message_created:   "メッセージを1件以上追加した",
  flow_connected:    "フェーズ間の遷移を1件以上設定した",
  previewed:         "プレビューを1回以上実行した",
};
