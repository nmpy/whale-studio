"use client";

// src/components/liff/ui/LiffChoiceRow.tsx
//
// LIFF 新UI: 単一の選択肢行（radio / checkbox）。緑アクセントの丸い選択 UI。
//   グループ化（複数行のまとめ）は呼び出し側（PR2 の SurveyRenderer）で行う想定の薄い部品。

import type { ReactNode } from "react";
import { cx } from "./tokens";

interface Props {
  type: "radio" | "checkbox";
  /** radio の input name（同一グループで共有）。 */
  name?: string;
  value: string;
  checked: boolean;
  onChange: (value: string, checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function LiffChoiceRow({ type, name, value, checked, onChange, label, disabled, className }: Props) {
  return (
    <label
      className={cx(
        "flex items-start gap-2.5 text-[15px] leading-[1.5] py-2 min-h-[28px]",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(value, e.target.checked)}
        className="mt-[2px] w-[18px] h-[18px] accent-[color:var(--liff-line-green,#06C755)]"
      />
      <span className="flex-1 min-w-0 break-words text-[color:var(--liff-primary-text)]">{label}</span>
    </label>
  );
}
