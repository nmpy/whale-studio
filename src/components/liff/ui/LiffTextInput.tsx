"use client";

// src/components/liff/ui/LiffTextInput.tsx
//
// LIFF 新UI: 下線型の 1 行テキスト入力。箱型の primitives/LiffInput とは別系統（既存は壊さない）。
//   ラベルやカードは LiffQuestionCard 側が持つ想定なので、ここは control だけを薄く提供する。

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cx, LIFF_UNDERLINE_INPUT, LIFF_UNDERLINE_INPUT_ERROR } from "./tokens";

export type LiffTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & {
  type?: "text" | "email" | "tel" | "url" | "search";
  error?: boolean;
  className?: string;
};

export const LiffTextInput = forwardRef<HTMLInputElement, LiffTextInputProps>(
  function LiffTextInput({ type = "text", error, className, ...rest }, ref) {
    return (
      <input
        {...rest}
        ref={ref}
        type={type}
        aria-invalid={error || undefined}
        className={cx(LIFF_UNDERLINE_INPUT, error && LIFF_UNDERLINE_INPUT_ERROR, className)}
      />
    );
  },
);
