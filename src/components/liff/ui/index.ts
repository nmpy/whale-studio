// src/components/liff/ui/index.ts
//
// LIFF 新UI（プレイヤー側）デザインシステムの薄い共通層バレル。
//
// 位置づけ:
//   - 既存 `primitives/`（LiffCard / LiffButton / LiffField …）は温存（破壊的変更なし）。
//   - `ui/` は新デザインシステム仕様（カード radius10 + 箱型ボタン radius12 + 下線入力 +
//     カプセルトグル/スイッチ + 矩形タグバッジ）に寄せた新UI部品。
//   - このPR(PR1)では既存 renderer に未配線。後続 PR で段階適用する。
//   - CMS の Tailwind brand / buttonClass / InlineWhaleLoader は使わない（プレイヤー専用・--liff-* token）。
//   - 通常アクション = LiffActionButton（箱型）。pill/capsule = LiffCapsuleToggle（トグル専用）。

export {
  cx, actionButtonClass,
  LIFF_RADIUS, LIFF_TEXT, LIFF_CARD_CLASS,
  LIFF_BRAND, LIFF_GREEN_PRESSED, LIFF_TINT, LIFF_TINT_BG,
  LIFF_UI_FONT_STACK, LIFF_UI_FONT_STYLE,
} from "./tokens";
export type { LiffActionVariant } from "./tokens";

export { LiffPageShell } from "./LiffPageShell";
export { LiffPageHeader } from "./LiffPageHeader";
export { LiffQuestionBadge } from "./LiffQuestionBadge";
export { LiffTagBadge } from "./LiffTagBadge";
export { LiffQuestionCard } from "./LiffQuestionCard";
export { LiffChoiceRow } from "./LiffChoiceRow";
export { LiffCapsuleToggle } from "./LiffCapsuleToggle";
export { LiffSwitch } from "./LiffSwitch";
export { LiffTextInput } from "./LiffTextInput";
export type { LiffTextInputProps } from "./LiffTextInput";
export { LiffTextarea } from "./LiffTextarea";
export type { LiffTextareaProps } from "./LiffTextarea";
export { LiffActionButton } from "./LiffActionButton";
export { LiffAccordionCard } from "./LiffAccordionCard";
export { LiffLoadingState, LiffErrorState, LiffEmptyState } from "./LiffStatusState";
export { LiffPoweredBy, shouldShowWhaleStudioCredit } from "./LiffPoweredBy";
