// src/lib/onboarding-setup.ts
// 作品トップの「セットアップの進捗」ステッパー用の純ロジック（表示コンポーネントから分離してテスト可能に）。
//
// ステップは4項目: 作品作成 / キャラクター作成 / フェーズ作成 / メッセージ追加。
// ※ 完了条件から除外しているもの:
//    - 「プレビュー確認」: 実機LINEで確認する運用に変更したため（PR #516）。
//    - 「フロー設定」: 作品設計に応じて任意で設定するもので、初期セットアップの必須タスクとして
//                      見せない方針のため（フロー機能そのもの・遷移ロジックは不変）。
//   （オンボーディング funnel 分析用の ONBOARDING_STEPS 定数とは別物。ここは作品トップ表示専用。）

export const SETUP_STEPS = [
  { key: "work",      label: "作品作成",          href: "" },
  { key: "character", label: "キャラクター作成",   href: "characters" },
  { key: "phase",     label: "フェーズ作成",       href: "scenario" },
  { key: "message",   label: "メッセージ追加",     href: "messages" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

export interface SetupState {
  hasCharacters:  boolean;
  hasPhases:      boolean;
  hasMessages:    boolean;
  /**
   * フロー(遷移)設定の有無。セットアップ完了条件には含めない（任意タスク扱い）。
   * 呼び出し側が従来どおり渡してもエラーにならないよう受け取るが、進捗計算では使用しない。
   */
  hasTransitions?: boolean;
}

export interface SetupProgress {
  completion: Record<SetupStepKey, boolean>;
  /** 総ステップ数（4固定） */
  total:      number;
  doneCount:  number;
  /** 完了率（0–100・四捨五入） */
  pct:        number;
  /** 次にやるべき（最初の未完了）ステップ key。全完了なら null。 */
  nextKey:    SetupStepKey | null;
  allDone:    boolean;
}

/**
 * セットアップ進捗を算出する（4項目基準）。
 * - work は常に完了（作品トップを開けている時点で作品は存在する）。
 * - character/phase/message は各 has* フラグ。
 * - フロー設定（hasTransitions）・プレビュー確認は完了条件に含めない。
 */
export function computeSetupProgress(state: SetupState): SetupProgress {
  const completion: Record<SetupStepKey, boolean> = {
    work:      true,
    character: state.hasCharacters,
    phase:     state.hasPhases,
    message:   state.hasMessages,
  };
  const total     = SETUP_STEPS.length; // 4
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
