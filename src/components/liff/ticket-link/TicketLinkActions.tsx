// src/components/liff/ticket-link/TicketLinkActions.tsx
//
// 下部操作エリア。メインボタン（グリーン / 中立）とその下のテキストボタン。
// position:fixed は使わない（TicketLinkShell の flex 末尾に置かれる）。

import type { ReactNode } from "react";
import { cx } from "../ui/tokens";
import { TL_CTA_PRIMARY, TL_CTA_NEUTRAL, TL_TEXT_BUTTON } from "./styles";

interface PrimaryProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** 送信中。ボタン内にローディングを出し、二重押下を防ぐ。 */
  busy?: boolean;
  /** 白背景 + 薄いボーダーの中立ボタン（完了画面の「閉じる」）。 */
  tone?: "primary" | "neutral";
  className?: string;
}

export function TicketLinkPrimaryButton({
  children, onClick, disabled, busy, tone = "primary", className,
}: PrimaryProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(tone === "neutral" ? TL_CTA_NEUTRAL : TL_CTA_PRIMARY, className)}
    >
      {busy && (
        <span
          className="mr-2 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

interface TextButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export function TicketLinkTextButton({ children, onClick, disabled }: TextButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={TL_TEXT_BUTTON}>
      {children}
    </button>
  );
}

/** メインボタン + テキストボタンの並び（間隔を 1 か所で持つ）。 */
export function TicketLinkActions({ children }: { children: ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}
