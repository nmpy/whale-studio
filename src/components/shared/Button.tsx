// src/components/shared/Button.tsx
// 共通ボタン。デザインガイド §4 「Button」 に準拠。
//
// variants:
//   primary — 実行・追加・保存・プレビュー。グラデ + 軽い影。
//   ghost   — サブアクション。白地 + 細罫線、hover で brand 系へ。
//   danger  — 削除専用。淡い赤背景 + 縁。
//
// サイズ:
//   md (default) — 本文サイズ + パディング
//   sm           — 行内 / 補助アクション
//
// 機能・状態管理は持たない (= 見た目専用)。`asChild` 等の prop は不要なので持たない。

import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";
type Size    = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?:    Size;
  fullWidth?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-bold " +
  "transition-[transform,box-shadow,background-color,color,border-color] " +
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none " +
  "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20";

const variants: Record<Variant, string> = {
  primary:
    "text-white bg-gradient-to-br from-brand to-brand-deep " +
    "shadow-[0_3px_12px_rgba(34,197,94,.28)] " +
    "hover:-translate-y-px hover:shadow-[0_5px_16px_rgba(34,197,94,.32)] " +
    "active:translate-y-0",
  ghost:
    "bg-white border border-line text-ink-2 " +
    "hover:border-brand hover:text-brand-ink hover:bg-brand-mist",
  danger:
    "bg-danger-soft border border-danger/30 text-danger " +
    "hover:bg-danger/15 hover:border-danger/50",
};

const sizes: Record<Size, string> = {
  md: "px-5 py-2.5 text-[13px]",
  sm: "px-3.5 py-1.5 text-[12px]",
};

/** 共通ボタン (= ガイド §4 準拠)。
 *  実装メモ: variant="primary" は実行系のみ。多用しないこと (§1)。 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", fullWidth, className = "", ...rest },
  ref,
) {
  const cls = [
    base,
    variants[variant],
    sizes[size],
    fullWidth ? "w-full" : "",
    className,
  ].filter(Boolean).join(" ");
  return <button ref={ref} className={cls} {...rest} />;
});
