// src/lib/onboarding-setup.ts
// 作品トップの「セットアップの進捗」ステッパー用の純ロジック（表示コンポーネントから分離してテスト可能に）。
//
// ステップは5項目: 作品作成 / キャラクター作成 / フェーズ作成 / メッセージ追加 / フロー設定。
// ※「プレビュー確認」は実機LINEで確認する運用に変更したため、セットアップ完了条件から除外している。
//   （オンボーディング funnel 分析用の ONBOARDING_STEPS 定数とは別物。ここは作品トップ表示専用。）

export const SETUP_STEPS = [
  { key: "work",      label: "作品作成",          href: "" },
  { key: "character", label: "キャラクター作成",   href: "characters" },
  { key: "phase",     label: "フェーズ作成",       href: "scenario" },
  { key: "message",   label: "メッセージ追加",     href: "messages" },
  { key: "scenario",  label: "フロー設定",         href: "scenario" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

export interface SetupState {
  hasCharacters:  boolean;
  hasPhases:      boolean;
  hasMessages:    boolean;
  hasTransitions: boolean;
}

export interface SetupProgress {
  completion: Record<SetupStepKey, boolean>;
  /** 総ステップ数（5固定） */
  total:      number;
  doneCount:  number;
  /** 完了率（0–100・四捨五入） */
  pct:        number;
  /** 次にやるべき（最初の未完了）ステップ key。全完了なら null。 */
  nextKey:    SetupStepKey | null;
  allDone:    boolean;
}

/**
 * セットアップ進捗を算出する。
 * - work は常に完了（作品トップを開けている時点で作品は存在する）。
 * - character/phase/message/scenario は各 has* フラグ。
 * - preview（プレビュー確認）は完了条件に含めない。
 */
export function computeSetupProgress(state: SetupState): SetupProgress {
  const completion: Record<SetupStepKey, boolean> = {
    work:      true,
    character: state.hasCharacters,
    phase:     state.hasPhases,
    message:   state.hasMessages,
    scenario:  state.hasTransitions,
  };
  const total     = SETUP_STEPS.length; // 5
  const doneCount = SETUP_STEPS.filter((s) => completion[s.key]).length;
  const pct       = Math.round((doneCount / total) * 100);
  const nextStep  = SETUP_STEPS.find((s) => !completion[s.key]) ?? null;
  return {
    completion,
    total,
    doneCount,
    pct,
    nextKey: nextStep?.key ?? null,
    allDone: doneCount === total,
  };
}
