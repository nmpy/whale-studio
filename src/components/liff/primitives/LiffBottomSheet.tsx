"use client";

// src/components/liff/primitives/LiffBottomSheet.tsx
//
// LIFF プレイヤー向けハーフモーダル（画面下から出るボトムシート）。
// キャラクター詳細などで使う想定（本 PR では画面へは未適用）。
//
// 仕様:
//   - モバイル LIFF 前提。画面下に貼り付くシート + 背景オーバーレイ。
//   - ESC キー / オーバーレイクリックで閉じる。
//   - open 中は body スクロールをロックする。
//   - role="dialog" / aria-modal / aria-labelledby / aria-describedby。
//   - SSR 安全: createPortal は mounted 後かつ open のときのみ実行する
//     （document を直接参照しない）。

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface Props {
  /** 開閉状態。false のときは何も描画しない。 */
  open: boolean;
  /** 閉じる要求（ESC / オーバーレイ / 閉じるボタン）。 */
  onClose: () => void;
  /** 見出し。指定時は aria-labelledby に紐づく。 */
  title?: string;
  /** 補助説明。指定時は aria-describedby に紐づく。 */
  description?: string;
  /** シート本文。 */
  children?: ReactNode;
  /** シート本文ラッパに足すクラス。 */
  className?: string;
  /** 下部に固定するフッタ（アクションボタン等）。 */
  footer?: ReactNode;
  /** 閉じるボタンの aria-label。既定「閉じる」。 */
  closeLabel?: string;
}

export function LiffBottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
  footer,
  closeLabel = "閉じる",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descId  = useId();

  // App Router / SSR 安全化: クライアントマウント後にだけ portal を有効化する。
  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC で閉じる（open のときだけ購読）。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // body スクロールロック（open の間だけ）。元の値を保存して復元する。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center liff-font"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
    >
      {/* オーバーレイ（クリックで閉じる） */}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 cursor-default"
      />

      {/* シート本体 */}
      <div
        className={[
          "relative w-full max-w-[448px] bg-[color:var(--liff-surface,#fff)]",
          "rounded-t-[18px] shadow-[0_-4px_20px_rgba(31,64,92,0.12)]",
          "max-h-[85vh] flex flex-col",
          className ?? "",
        ].filter(Boolean).join(" ")}
      >
        {/* グラブハンドル */}
        <div className="pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <span className="block h-1 w-10 rounded-full bg-[color:var(--liff-border-strong,#E0E2E5)]" />
        </div>

        {/* ヘッダ（title / description / 閉じる） */}
        {(title || description) && (
          <div className="px-4 pt-1 pb-2 shrink-0">
            {title && (
              <h2
                id={titleId}
                className="text-[16px] font-bold leading-[1.5] text-[color:var(--liff-primary-text)] break-words pr-8"
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                id={descId}
                className="mt-1 text-[13px] leading-[1.6] text-[color:var(--liff-secondary-text)] break-words"
              >
                {description}
              </p>
            )}
          </div>
        )}

        {/* 右上の閉じるボタン */}
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute right-3 top-3 h-8 w-8 inline-flex items-center justify-center rounded-full text-[color:var(--liff-secondary-text)] active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)]"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">×</span>
        </button>

        {/* スクロール可能な本文 */}
        <div className={["overflow-y-auto px-4 pb-4", title || description ? "pt-0" : "pt-2"].join(" ")}>
          {children}
        </div>

        {/* フッタ（任意・固定） */}
        {footer && (
          <div className="shrink-0 border-t border-[color:var(--liff-border)] px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
