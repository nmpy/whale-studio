"use client";

// src/components/liff/primitives/LiffButton.tsx
//
// LINE Design System の Box Button に準拠した LIFF プレイヤー共通ボタン。
//
// 設計方針:
//   - 高さ:    48px (h-12) — LINE Design System の Box Button 標準
//   - 角丸:    10px (--liff-button-radius)
//   - 横幅:    親に追従 (デフォルト fullWidth)
//   - フォント: 15px / font-bold
//   - 押下:    active:opacity-90 で軽い視覚フィードバック
//   - loading: 二重送信防止のため自動で disabled
//
// バリアント:
//   - primary  : LINE Primary Green (#06C755) の塗り。Primary CTA 用 (Survey 送信 / 謎解き開始 等)
//   - outline  : Primary Green の枠線 + 白背景。補助導線 / 再開ボタン用
//   - ghost    : Outline + 緑文字。Hint Site の補助 CTA に
//   - dark     : 濃いダーク塗り。背景の明るい場面でセカンダリ強調
//   - danger   : Danger (赤) — 破壊操作用 (将来用、まだ呼び出し元なし)
//
// "as" prop:
//   - "button"  (default): <button> として描画
//   - "a"      : <a href> として描画 (リンク誘導用、ButtonLinkBlock で利用)

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";

export type LiffButtonVariant = "primary" | "outline" | "ghost" | "dark" | "danger";
export type LiffButtonSize    = "md" | "sm";

const VARIANT_CLASSES: Record<LiffButtonVariant, string> = {
  primary:
    "text-white bg-[color:var(--liff-line-green,#06C755)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:var(--liff-line-green-press,#05B14C)] active:border-[color:var(--liff-line-green-press,#05B14C)]",
  outline:
    "text-[color:var(--liff-line-green,#06C755)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:rgba(6,199,85,0.06)]",
  ghost:
    "text-[color:var(--liff-line-green,#06C755)] bg-transparent border border-transparent " +
    "active:bg-[color:rgba(6,199,85,0.08)]",
  dark:
    "text-white bg-[color:var(--liff-primary-text,#111)] border border-[color:var(--liff-primary-text,#111)] " +
    "active:opacity-90",
  danger:
    "text-white bg-[color:var(--liff-danger,#E22B2B)] border border-[color:var(--liff-danger,#E22B2B)] " +
    "active:bg-[color:var(--liff-danger-press,#C42323)] active:border-[color:var(--liff-danger-press,#C42323)]",
};

const SIZE_CLASSES: Record<LiffButtonSize, string> = {
  md: "h-12 px-4 text-[15px]",
  sm: "h-10 px-3 text-[14px]",
};

// 共通クラス。tap target は最低 44px (iOS HIG)、active:opacity でフォールバック視覚フィードバック。
const BASE_CLASSES =
  "inline-flex items-center justify-center font-bold tracking-tight rounded-[10px] " +
  "transition-colors transition-opacity " +
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1";

interface CommonProps {
  variant?:  LiffButtonVariant;
  size?:     LiffButtonSize;
  /** 親幅いっぱいに広げる (デフォルト true) */
  fullWidth?: boolean;
  /** 通信中等の状態。true なら disabled になり、ラベルが小さく置換される */
  loading?:  boolean;
  /** loading=true のときに表示するラベル (省略時は children をそのまま表示) */
  loadingLabel?: ReactNode;
  /** 子要素 (ボタン内テキスト / アイコン) */
  children?: ReactNode;
  /** 既存 className との合成用 */
  className?: string;
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className"> & {
  as?: "button";
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
};

type AnchorProps = CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & {
  as: "a";
};

type Props = ButtonProps | AnchorProps;

function buildClass(props: Props): string {
  const variant = props.variant ?? "primary";
  const size    = props.size ?? "md";
  const fullWidth = props.fullWidth !== false; // default true
  return [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? "w-full" : "",
    props.className ?? "",
  ].filter(Boolean).join(" ");
}

export const LiffButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  function LiffButton(props, ref) {
    const className = buildClass(props);
    const isLoading = props.loading === true;
    const content = isLoading ? (props.loadingLabel ?? props.children) : props.children;

    if (props.as === "a") {
      const {
        as: _as,
        variant: _v, size: _s, fullWidth: _fw, loading: _l, loadingLabel: _ll,
        className: _c, children: _ch,
        ...anchorProps
      } = props;
      void _as; void _v; void _s; void _fw; void _l; void _ll; void _c; void _ch;
      return (
        <a
          {...anchorProps}
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={className}
          aria-disabled={isLoading || undefined}
        >
          {content}
        </a>
      );
    }

    const {
      as: _as,
      variant: _v, size: _s, fullWidth: _fw, loading: _l, loadingLabel: _ll,
      className: _c, children: _ch,
      disabled,
      ...buttonProps
    } = props;
    void _as; void _v; void _s; void _fw; void _l; void _ll; void _c; void _ch;

    return (
      <button
        {...buttonProps}
        ref={ref as React.Ref<HTMLButtonElement>}
        className={className}
        disabled={isLoading || disabled}
      >
        {content}
      </button>
    );
  }
);
