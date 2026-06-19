"use client";

// src/components/liff/ui/LiffSwitch.tsx
//
// LIFF 新UI: プレイヤー用スイッチ（on=green #06C755 / off=gray）。
//   CMS の `@/components/Switch` とは別物（player token のみ・CMS 非依存）。
//   controlled（checked / onChange）。ラベルは呼び出し側で添える想定の最小トグル。

import { cx } from "./tokens";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function LiffSwitch({ checked, onChange, disabled, className, ...rest }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex items-center w-[44px] h-[26px] rounded-full transition-colors shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1",
        checked ? "bg-[color:var(--liff-line-green,#06C755)]" : "bg-[color:#C7CDD4]",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}
