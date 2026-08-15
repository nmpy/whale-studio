"use client";

// src/components/liff/hint-search/HintDetailBody.tsx
//
// ヒント詳細の本文（段階ヒント + 答え導線）。
//
// 開示ルール:
//   - 開示済みの段階だけ本文を DOM に出す（CSS で隠すだけにはしない）。
//   - 次の 1 段だけ「表示する」ボタンとして出し、それ以降はロック行（本文なし）にする。
//   - 答えは本文をここに持たせない。開示済みのときだけ親から `answer` を渡してもらう。
//
// 開示段階の state は親（HintSearchRenderer）が持つ。一覧のステータス表示や
// 開封履歴の保存と同じ値を使う必要があるため、ここは controlled にしている。

import type { HintSearchDetail } from "@/lib/liff/hint-search";
import { spoilerLevelForHint } from "@/lib/liff/hint-search";
import { LIFF_CARD_CLASS, LIFF_TEXT, actionButtonClass, cx } from "../ui/tokens";
import { HINT_SEARCH_COPY as C } from "./copy";
import { SpoilerBadge } from "./SpoilerBadge";

interface Props {
  detail: HintSearchDetail;
  /** 開示済みの段階数（1 以上）。 */
  revealed: number;
  onReveal: () => void;
  /** 開示済みの答え本文。未開示なら null。 */
  answer: string | null;
  /** 答え確認画面へ進む。答えが無いページでは undefined。 */
  onRequestAnswer?: () => void;
}

export function HintDetailBody({ detail, revealed, onReveal, answer, onRequestAnswer }: Props) {
  const total = detail.hints.length;
  const shown = Math.min(Math.max(revealed, 1), total);

  return (
    <div className="flex flex-col gap-3">
      {detail.hints.map((hint) => {
        const isShown  = hint.level <= shown;
        const isNext   = hint.level === shown + 1;
        const isLocked = hint.level > shown + 1;
        return (
          <section
            key={hint.level}
            className={cx(
              LIFF_CARD_CLASS,
              "px-4 py-4",
              isLocked && "border-dashed bg-[color:var(--liff-surface-subtle,#FAFAFA)] shadow-none",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3
                className={cx(
                  "text-[14px] font-bold",
                  isLocked
                    ? "text-[color:var(--liff-tertiary-text,#8C8C8C)]"
                    : "text-[color:var(--liff-primary-text)]",
                )}
              >
                {C.hintLevelLabel(hint.level)}
              </h3>
              {isLocked ? (
                <span className="text-[11px] text-[color:var(--liff-tertiary-text,#8C8C8C)]">
                  {C.lockedHint(hint.level - 1)}
                </span>
              ) : (
                <SpoilerBadge level={spoilerLevelForHint(hint.level)} />
              )}
            </div>

            {isShown && (
              <p className={cx(LIFF_TEXT.body, "mt-2 whitespace-pre-wrap break-words")}>
                {hint.body}
              </p>
            )}

            {isNext && (
              <button
                type="button"
                onClick={onReveal}
                // 次の 1 段はカード内の副次アクション。ブランド色は使わない（neutral）。
                className={actionButtonClass("neutral", { className: "mt-3" })}
              >
                {hint.level === shown + 1 && shown === 1 ? C.revealNext : C.revealLevel(hint.level)}
              </button>
            )}
          </section>
        );
      })}

      {/* 答え。開示済みなら本文、未開示なら確認画面への導線だけを出す。 */}
      {answer !== null ? (
        <section className="px-4 py-4 rounded-[10px] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-danger,#E22B2B)] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <h3 className="text-[14px] font-bold text-[color:var(--liff-danger,#E22B2B)]">
            {C.answerHeading}
          </h3>
          <p className={cx(LIFF_TEXT.body, "mt-2 whitespace-pre-wrap break-words")}>{answer}</p>
        </section>
      ) : detail.hasAnswer && onRequestAnswer ? (
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onRequestAnswer}
            className={actionButtonClass("dangerOutline")}
          >
            {C.answerOpen}
          </button>
          <p className={LIFF_TEXT.caption}>{C.answerCaution}</p>
        </div>
      ) : null}
    </div>
  );
}
