// src/components/liff/ui/index.ts
//
// LIFF 新UI（プレイヤー側）デザインシステムの薄い共通層バレル。
//
// 位置づけ:
//   - 既存 `primitives/`（LiffCard / LiffButton / LiffField …）は温存（破壊的変更なし）。
//   - `ui/` は参考デザイン（カード積み重ね + ピルボタン + 下線入力 + Q バッジ）に寄せた新UI部品。
//   - このPR(PR1)では既存 renderer に未配線。PR2 以降で SurveyRenderer 等に段階適用する。
//   - CMS の Tailwind brand / buttonClass / InlineWhaleLoader は使わない（プレイヤー専用・--liff-* token）。

export { cx, actionButtonClass, LIFF_RADIUS, LIFF_TEXT, LIFF_CARD_CLASS } from "./tokens";
export type { LiffActionVariant } from "./tokens";

export { LiffPageShell } from "./LiffPageShell";
export { LiffPageHeader } from "./LiffPageHeader";
export { LiffQuestionBadge } from "./LiffQuestionBadge";
export { LiffQuestionCard } from "./LiffQuestionCard";
export { LiffChoiceRow } from "./LiffChoiceRow";
export { LiffTextInput } from "./LiffTextInput";
export type { LiffTextInputProps } from "./LiffTextInput";
export { LiffTextarea } from "./LiffTextarea";
export type { LiffTextareaProps } from "./LiffTextarea";
export { LiffActionButton } from "./LiffActionButton";
export { LiffAccordionCard } from "./LiffAccordionCard";
export { LiffLoadingState, LiffErrorState, LiffEmptyState } from "./LiffStatusState";
export { LiffPoweredBy, shouldShowWhaleStudioCredit } from "./LiffPoweredBy";
