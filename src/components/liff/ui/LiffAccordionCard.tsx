"use client";

// src/components/liff/ui/LiffAccordionCard.tsx
//
// LIFF 新UI: 開閉カード（FAQ / ヒント開示 / 問題詳細などで共通利用）。
//   open / onToggle は呼び出し側が制御（controlled）。既存 FaqRenderer の FaqRow と AccordionBlock の
//   見た目を将来一本化するための土台（このPRでは未配線）。

import type { ReactNode } from "react";
import { cx, LIFF_CARD_CLASS, LIFF_TEXT } from "./tokens";

interface Props {
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
  /** タイトル左に出すバッジ等（任意）。 */
  leading?: ReactNode;
  children?: ReactNode;
  /** パネルの id（aria-controls 用）。 */
  panelId?: string;
  className?: string;
}

export function LiffAccordionCard({ open, onToggle, title, leading, children, panelId, className }: Props) {
  return (
    <div className={cx(LIFF_CARD_CLASS, "overflow-hidden", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 text-left px-5 min-h-[60px] py-3 transition-colors active:bg-[color:var(--liff-surface-subtle,#FAFAFA)]"
      >
        <span className="flex items-center gap-2.5 min-w-0 flex-1">
          {leading}
          <span className={cx("min-w-0 flex-1", LIFF_TEXT.headerTitle)}>{title}</span>
        </span>
        <svg
          aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={cx("shrink-0 text-[color:var(--liff-secondary-text)] transition-transform", open && "rotate-180")}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div id={panelId} className="px-5 pb-5 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
