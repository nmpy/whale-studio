"use client";

import type { DividerSettings } from "@/types";
import { resolveDividerStyle } from "../divider-style";

export function DividerBlock({ settings }: { settings: DividerSettings }) {
  // PR-BLK4c: style(solid/dashed/dotted/thick/label) を解決。未設定/不明/label空 → solid。
  const style = resolveDividerStyle(settings.style, settings.label);

  // 太め: 細い hr ではなく控えめなバンド（色は既存トークン・hex なし）。
  if (style === "thick") {
    return <div className="my-3 h-[6px] rounded-full bg-[color:var(--liff-surface-subtle)]" aria-hidden="true" />;
  }

  // ラベル付き: 左線 + 中央テキスト + 右線。テキストを含むので role="separator" + aria-label。
  if (style === "label") {
    return (
      <div className="my-3 flex items-center gap-3" role="separator" aria-label={settings.label || undefined}>
        <span className="flex-1 h-px bg-[color:var(--liff-border)]" aria-hidden="true" />
        <span className="shrink-0 text-[11.5px] text-[color:var(--liff-tertiary-text)] break-words">
          {settings.label}
        </span>
        <span className="flex-1 h-px bg-[color:var(--liff-border)]" aria-hidden="true" />
      </div>
    );
  }

  // solid / dashed / dotted は <hr> ベース（装飾なので aria-hidden）。
  const borderCls =
    style === "dashed" ? "border-dashed" :
    style === "dotted" ? "border-dotted" :
    "border-solid";
  return (
    <hr
      className={`my-3 border-t ${borderCls} border-[color:var(--liff-border)]`}
      aria-hidden="true"
    />
  );
}
