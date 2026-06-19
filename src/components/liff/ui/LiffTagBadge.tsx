// src/components/liff/ui/LiffTagBadge.tsx
//
// LIFF 新UI: 矩形タグバッジ（radius 2px）。「謎」「カテゴリ」等のラベル用。
//   設問の Q バッジ（円）とは用途を分離する（混同回避）。
//   tone: "tint"（淡い緑面 #E8F9EE + 緑文字）/ "neutral"（薄グレー面）。

import type { ReactNode } from "react";
import { cx } from "./tokens";

interface Props {
  children: ReactNode;
  tone?: "tint" | "neutral";
  className?: string;
}

export function LiffTagBadge({ children, tone = "tint", className }: Props) {
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-[2px] px-1.5 py-0.5 text-[12.5px] font-bold leading-none",
        tone === "tint"
          ? "bg-[color:#E8F9EE] text-[color:var(--liff-line-green,#06C755)]"
          : "bg-[color:var(--liff-surface-subtle,#F2F4F6)] text-[color:var(--liff-secondary-text,#5B6168)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
