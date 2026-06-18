// src/components/liff/ui/LiffStatusState.tsx
//
// LIFF 新UI: loading / error / empty の共通状態表示（プレイヤー専用）。
//   - CMS のローダー（InlineWhaleLoader 等）やブランドは一切持ち込まない。
//   - loading は既存 viewer と同じ「プレーンな緑アクセント spinner」。
//   - empty は既存 primitives/LiffEmptyState を再 export（二重実装しない）。
//   - error は 😢 カード（既存 viewer のエラー表示トーンを部品化）。

import { cx, LIFF_CARD_CLASS, LIFF_TEXT } from "./tokens";

// LiffEmptyState は primitives バレル未掲載のため、ファイルから直接 re-export（バレルは変更しない）。
export { LiffEmptyState } from "../primitives/LiffEmptyState";

interface LoadingProps {
  /** 中央寄せのフルスクリーンにするか（viewer 用）。既定 false（インライン）。 */
  fullScreen?: boolean;
  label?: string;
  className?: string;
}

export function LiffLoadingState({ fullScreen = false, label = "読み込み中...", className }: LoadingProps) {
  const spinner = (
    <div className="text-center">
      <div
        className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3"
        style={{ borderColor: "var(--liff-border)", borderTopColor: "var(--liff-line-green, #06C755)" }}
        aria-hidden="true"
      />
      <p className={LIFF_TEXT.secondary} role="status">{label}</p>
    </div>
  );
  if (fullScreen) {
    return (
      <div className={cx("min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center px-4", className)}>
        {spinner}
      </div>
    );
  }
  return <div className={cx(LIFF_CARD_CLASS, "px-4 py-6", className)}>{spinner}</div>;
}

interface ErrorProps {
  message?: string;
  title?: string;
  fullScreen?: boolean;
  emoji?: string;
  className?: string;
}

export function LiffErrorState({ message, title = "表示できません", fullScreen = false, emoji = "😢", className }: ErrorProps) {
  const card = (
    <div className={cx(LIFF_CARD_CLASS, "px-4 py-6 text-center", fullScreen && "max-w-sm w-full", className)}>
      <p className="text-4xl mb-3" aria-hidden="true">{emoji}</p>
      <h2 className={cx(LIFF_TEXT.sectionTitle, "mb-2")}>{title}</h2>
      {message && <p className={LIFF_TEXT.secondary}>{message}</p>}
    </div>
  );
  if (fullScreen) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center p-4">
        {card}
      </div>
    );
  }
  return card;
}
