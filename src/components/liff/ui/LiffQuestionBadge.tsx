// src/components/liff/ui/LiffQuestionBadge.tsx
//
// LIFF 新UI: 設問の「Q」バッジ（緑の淡い円 + 緑文字）。問題画面の「謎」バッジ等にも流用できるよう label を可変に。
// 装飾要素なので aria-hidden（読み上げはラベルテキスト側に任せる）。

import { cx, LIFF_TINT_BG } from "./tokens";

interface Props {
  /** 表示文字（既定 "Q"）。 */
  label?: string;
  className?: string;
}

export function LiffQuestionBadge({ label = "Q", className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-[12px] font-bold",
        LIFF_TINT_BG,
        "text-[color:var(--liff-line-green,#06C755)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
