// src/components/liff/ui/LiffQuestionCard.tsx
//
// LIFF 新UI: 1 設問 = 白カード。ヘッダー行（Q バッジ + 設問文 + 右側ヒント）+ 任意の補足 + control（children）。
//   既存 SurveyRenderer が primitives/LiffField のラベルに Q バッジを「注入」して崩れた反省から、
//   カードとラベルの入れ子を最初から正しい構造で提供する（PR2 で SurveyRenderer をこれに載せ替える想定）。
//
// ヒント（hint）は呼び出し側が組み立てて渡す（必須 * / 複数選択可 / 任意 等）。

import type { ReactNode } from "react";
import { cx, LIFF_CARD_CLASS, LIFF_TEXT } from "./tokens";
import { LiffQuestionBadge } from "./LiffQuestionBadge";

interface Props {
  /** 設問文。 */
  question: ReactNode;
  /** 右寄せヒント（必須 * / 複数選択可 / 任意 など）。 */
  hint?: ReactNode;
  /** バッジ文字（既定 "Q"）。 */
  badgeLabel?: string;
  /** バッジを出すか（既定 true）。 */
  showBadge?: boolean;
  /** 設問文の下に出す補足（プレースホルダ的な説明）。 */
  description?: ReactNode;
  /** control 本体（入力欄 / 選択肢）。 */
  children?: ReactNode;
  /** ラベルと control を関連付けるための id（aria）。 */
  labelId?: string;
  className?: string;
}

export function LiffQuestionCard({
  question, hint, badgeLabel, showBadge = true, description, children, labelId, className,
}: Props) {
  return (
    <div className={cx(LIFF_CARD_CLASS, "px-5 py-4 flex flex-col gap-3", className)}>
      <div className="flex items-start gap-2.5">
        {showBadge && <LiffQuestionBadge label={badgeLabel} className="mt-0.5" />}
        <span id={labelId} className={cx("flex-1 min-w-0", LIFF_TEXT.headerTitle)}>
          {question}
        </span>
        {hint && (
          <span className={cx("shrink-0 flex items-center gap-2", LIFF_TEXT.caption, "font-medium")}>
            {hint}
          </span>
        )}
      </div>
      {description && <p className={cx(LIFF_TEXT.caption)}>{description}</p>}
      {children}
    </div>
  );
}
