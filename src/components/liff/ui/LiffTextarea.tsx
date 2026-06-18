"use client";

// src/components/liff/ui/LiffTextarea.tsx
//
// LIFF 新UI: 下線型の複数行テキスト入力。箱型の primitives/LiffTextarea とは別系統（既存は壊さない）。

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cx, LIFF_UNDERLINE_INPUT, LIFF_UNDERLINE_INPUT_ERROR } from "./tokens";

export type LiffTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
  error?: boolean;
  className?: string;
};

export const LiffTextarea = forwardRef<HTMLTextAreaElement, LiffTextareaProps>(
  function LiffTextarea({ error, className, rows = 3, ...rest }, ref) {
    return (
      <textarea
        {...rest}
        ref={ref}
        rows={rows}
        aria-invalid={error || undefined}
        className={cx(LIFF_UNDERLINE_INPUT, "resize-y", error && LIFF_UNDERLINE_INPUT_ERROR, className)}
      />
    );
  },
);
