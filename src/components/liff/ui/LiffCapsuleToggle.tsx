"use client";

// src/components/liff/ui/LiffCapsuleToggle.tsx
//
// LIFF 新UI: カプセル型トグル（rounded-[16px]・高さ約42px）。
//   用途は「カテゴリ選択 / トグル / 選択状態表示」専用（通常アクションには使わない＝LiffActionButton）。
//   active:   緑塗り(#06C755) + チェック
//   inactive: 緑枠の outline
//   disabled: 不透明度低下。
//   controlled（selected / onToggle）。

import type { ReactNode } from "react";
import { cx } from "./tokens";

interface Props {
  selected: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  /** チェックを出すか（既定 true）。選択状態表示のみで out したい場合 false。 */
  showCheck?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function LiffCapsuleToggle({
  selected, onToggle, children, disabled, showCheck = true, className, ...rest
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={selected}
      aria-label={rest["aria-label"]}
      disabled={disabled}
      onClick={() => onToggle(!selected)}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[16px] min-h-[42px] px-4 text-[14px] font-bold",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1",
        selected
          ? "text-white bg-[color:var(--liff-line-green,#06C755)] border border-[color:var(--liff-line-green,#06C755)] active:bg-[color:#06A047]"
          : "text-[color:var(--liff-line-green,#06C755)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-line-green,#06C755)] active:bg-[color:#E8F9EE]",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {selected && showCheck && (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      <span className="min-w-0 break-words">{children}</span>
    </button>
  );
}
