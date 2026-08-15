"use client";

// src/components/liff/ui/LiffConfirmDialog.tsx
//
// LIFF 新UI: 確認ダイアログ（ネタバレ警告など「押した瞬間には進めない」導線用）。
//
// アクセシビリティ:
//   - role="dialog" + aria-modal + aria-labelledby / aria-describedby
//   - 開いた時点で Primary ではなく Secondary（戻る）にフォーカスを当てる
//     → Enter 連打で意図せず了承してしまう事故を防ぐ
//   - Tab / Shift+Tab をダイアログ内で循環（focus trap）
//   - ESC / 背景タップで閉じる（= キャンセル扱い）
//   - 閉じたら呼び出し元の要素へフォーカスを戻す
//   - div の onClick ではなく <button> で操作を実装する
//
// SP 前提のため、幅は画面から食み出さないよう max-width + 左右 gutter で抑える。

import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { actionButtonClass, cx, LIFF_TEXT } from "./tokens";

interface Props {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** Secondary（キャンセル）ラベル。既定 "戻る"。 */
  cancelLabel?: string;
  /** Primary（了承）ラベル。 */
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LiffConfirmDialog({
  open, title, description, cancelLabel = "戻る", confirmLabel, onCancel, onConfirm,
}: Props) {
  const panelRef   = useRef<HTMLDivElement | null>(null);
  const cancelRef  = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const reactId = useId();
  const titleId = `liff-dialog-title-${reactId}`;
  const descId  = `liff-dialog-desc-${reactId}`;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last  = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // 了承ボタンではなく「戻る」を初期フォーカスにする（誤操作でネタバレを開かせない）。
    cancelRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景。タップでキャンセル扱い。キーボードからは到達させない。 */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cx(
          "relative w-full max-w-[340px] rounded-[14px] bg-[color:var(--liff-surface,#fff)] p-5",
          "shadow-[0_8px_28px_rgba(0,0,0,0.18)]",
        )}
      >
        <h2 id={titleId} className={cx(LIFF_TEXT.headerTitle, "text-[16px]")}>{title}</h2>
        {description && (
          <p id={descId} className={cx(LIFF_TEXT.secondary, "mt-2 text-[13px] leading-[1.75] break-words")}>
            {description}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={actionButtonClass("outline")}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={actionButtonClass("filled")}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
