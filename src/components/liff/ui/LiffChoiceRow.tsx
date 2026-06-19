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
  // ネイティブ input（type=radio/checkbox）はブラウザ既定の黒い縁・黒チェックが出るため、
  // input は視覚的に隠して state / キーボード操作のみ担い、見た目は下のカスタム span で描く。
  //   radio:    グレー枠の丸 + 選択時に内側へ緑の小円。
  //   checkbox: 選択時に緑塗り + 白い ✓ / 未選択はグレー枠。
  // ※ onChange / checked / value の挙動は不変（input をそのまま使う）。
  return (
    <label
      className={cx(
        "flex items-center gap-3 text-[14px] leading-[1.5] py-1.5 min-h-[28px]",
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
        className="sr-only peer"
      />
      <span
        aria-hidden="true"
        className={cx(
          "shrink-0 inline-flex items-center justify-center w-[22px] h-[22px] rounded-full box-border transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-[color:var(--liff-line-green,#06C755)] peer-focus-visible:ring-offset-1",
          type === "checkbox" && checked
            ? "bg-[color:var(--liff-line-green,#06C755)] text-white text-[13px] leading-none"
            : "border-[1.5px] border-[color:var(--liff-border,#DFDFDF)] bg-transparent",
        )}
      >
        {type === "checkbox" && checked && "✓"}
        {type === "radio" && checked && (
          <span className="w-[13px] h-[13px] rounded-full bg-[color:var(--liff-line-green,#06C755)]" />
        )}
      </span>
      <span className="flex-1 min-w-0 break-words text-[color:var(--liff-primary-text)]">{label}</span>
    </label>
  );
}
