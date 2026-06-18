// src/components/liff/primitives/LiffCard.tsx
//
// LIFF プレイヤー画面共通のカード面。
// 既存カード（LiffEmptyState / ホームカード）と同じトーンに揃える:
//   白サーフェス + 薄い境界 + radius 18 + 控えめな影。
//
// 今後の利用先（本 PR では既存画面へ大規模適用はしない）:
//   ホームカード / FAQ 項目 / 問題カード / アンケート設問 /
//   チェックイン履歴カード / キャラクター詳細カード 等。
//
// "as" prop:
//   - "div" (default): 静的カード
//   - "button"        : タップ可能カード（onClick 等）
//   - "a"             : リンクカード（href）
// interactive / selected / disabled は as に依らず付与できる。

import { forwardRef } from "react";
import type {
  HTMLAttributes,
  ButtonHTMLAttributes,
  AnchorHTMLAttributes,
  ReactNode,
} from "react";

export type LiffCardPadding = "none" | "sm" | "md" | "lg";

const PADDING_CLASSES: Record<LiffCardPadding, string> = {
  none: "",
  sm:   "p-3",
  md:   "p-4",
  lg:   "p-5",
};

// 既存カード（LiffEmptyState）と同一の面トーン。視覚差分を出さないため literal で固定。
const BASE_CLASSES =
  "bg-[color:var(--liff-surface,#fff)] rounded-[18px] " +
  "shadow-[0_2px_10px_rgba(31,64,92,0.05)]";

const DEFAULT_BORDER = "border border-[color:var(--liff-border)]";
const SELECTED_BORDER =
  "border border-[color:var(--liff-line-green,#06C755)] ring-1 ring-[color:var(--liff-line-green,#06C755)]";

const INTERACTIVE_CLASSES =
  "text-left w-full transition-colors cursor-pointer " +
  "active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] " +
  "focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1";

const DISABLED_CLASSES = "opacity-50 pointer-events-none";

interface CommonProps {
  children?:   ReactNode;
  className?:  string;
  /** 内側余白。既定 "md"。 */
  padding?:    LiffCardPadding;
  /** タップ操作のフィードバック（cursor / active / focus ring）。as が button/a のときは既定 true。 */
  interactive?: boolean;
  /** 選択状態（LINE green の枠線）。 */
  selected?:   boolean;
  /** 非活性表示。button のときは disabled 属性も付与。 */
  disabled?:   boolean;
}

type DivProps = CommonProps &
  Omit<HTMLAttributes<HTMLDivElement>, "className"> & { as?: "div" };
type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & { as: "button" };
type AnchorProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { as: "a" };

type Props = DivProps | ButtonProps | AnchorProps;

function isInteractive(props: Props): boolean {
  return props.interactive ?? (props.as === "button" || props.as === "a");
}

function buildClass(props: Props): string {
  const padding = props.padding ?? "md";
  return [
    BASE_CLASSES,
    props.selected ? SELECTED_BORDER : DEFAULT_BORDER,
    PADDING_CLASSES[padding],
    isInteractive(props) ? INTERACTIVE_CLASSES : "",
    props.disabled ? DISABLED_CLASSES : "",
    props.className ?? "",
  ].filter(Boolean).join(" ");
}

export const LiffCard = forwardRef<
  HTMLDivElement | HTMLButtonElement | HTMLAnchorElement,
  Props
>(function LiffCard(props, ref) {
  const className = buildClass(props);

  if (props.as === "button") {
    const {
      as: _as, className: _c, children,
      padding: _p, interactive: _i, selected: _s, disabled,
      ...rest
    } = props;
    void _as; void _c; void _p; void _i; void _s;
    return (
      <button
        {...rest}
        ref={ref as React.Ref<HTMLButtonElement>}
        className={className}
        disabled={disabled}
      >
        {children}
      </button>
    );
  }

  if (props.as === "a") {
    const {
      as: _as, className: _c, children,
      padding: _p, interactive: _i, selected: _s, disabled,
      ...rest
    } = props;
    void _as; void _c; void _p; void _i; void _s;
    return (
      <a
        {...rest}
        ref={ref as React.Ref<HTMLAnchorElement>}
        className={className}
        aria-disabled={disabled || undefined}
      >
        {children}
      </a>
    );
  }

  const {
    as: _as, className: _c, children,
    padding: _p, interactive: _i, selected: _s, disabled: _d,
    ...rest
  } = props;
  void _as; void _c; void _p; void _i; void _s; void _d;
  return (
    <div
      {...rest}
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
    >
      {children}
    </div>
  );
});
