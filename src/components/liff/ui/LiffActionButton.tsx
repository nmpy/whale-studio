"use client";

// src/components/liff/ui/LiffActionButton.tsx
//
// LIFF 新UI: ピル型アクションボタン。既存 primitives/LiffButton（radius10・箱型）は壊さず、
//   新UI用に「ピル型 + 高さ52px」を別部品として提供する。色トークンは LiffButton と同じ --liff-* 系。
//   variant: primary（緑塗り）/ dark / outline / ghost。as="a" でリンクにもできる。

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";
import { actionButtonClass, type LiffActionVariant } from "./tokens";

interface CommonProps {
  variant?: LiffActionVariant;
  fullWidth?: boolean;
  loading?: boolean;
  loadingLabel?: ReactNode;
  children?: ReactNode;
  className?: string;
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className"> & {
  as?: "button";
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
};
type AnchorProps = CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { as: "a" };
type Props = ButtonProps | AnchorProps;

export const LiffActionButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  function LiffActionButton(props, ref) {
    const className = actionButtonClass(props.variant ?? "primary", {
      fullWidth: props.fullWidth,
      className: props.className,
    });
    const isLoading = props.loading === true;
    const content = isLoading ? (props.loadingLabel ?? props.children) : props.children;

    if (props.as === "a") {
      const { as: _as, variant: _v, fullWidth: _fw, loading: _l, loadingLabel: _ll, className: _c, children: _ch, ...anchorProps } = props;
      void _as; void _v; void _fw; void _l; void _ll; void _c; void _ch;
      return (
        <a {...anchorProps} ref={ref as React.Ref<HTMLAnchorElement>} className={className} aria-disabled={isLoading || undefined}>
          {content}
        </a>
      );
    }
    const { as: _as, variant: _v, fullWidth: _fw, loading: _l, loadingLabel: _ll, className: _c, children: _ch, disabled, ...buttonProps } = props;
    void _as; void _v; void _fw; void _l; void _ll; void _c; void _ch;
    return (
      <button {...buttonProps} ref={ref as React.Ref<HTMLButtonElement>} className={className} disabled={isLoading || disabled}>
        {content}
      </button>
    );
  },
);
