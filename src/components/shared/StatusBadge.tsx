// src/components/shared/StatusBadge.tsx
// 共通ステータスバッジ。デザインガイド §4 「StatusBadge」 に準拠。
//
// tone:
//   active — 公開中 / 有効。brand-soft + brand-ink。先頭に外周リング付きの brand ドット。
//   muted  — 未設定 / 下書き / 無効。グレー + グレードット。
//   warn   — 構成上の注意 (= warn 色、煽らない)。
//
// プラン制限の表示には使わない (= ガイド §1.4: 制限・禁止・促進を出さない)。
// プラン制限用には別途 <PlanTag /> を使う。

import type { ReactNode } from "react";

type Tone = "active" | "muted" | "warn";

interface Props {
  tone?:     Tone;
  children:  ReactNode;
  className?: string;
}

const tones: Record<Tone, { wrap: string; dot: string }> = {
  active: {
    wrap: "bg-brand-soft text-brand-ink",
    dot:  "bg-brand shadow-[0_0_0_3px_rgba(34,197,94,.16)]",
  },
  muted: {
    wrap: "bg-line-2 text-ink-3",
    dot:  "bg-ink-3",
  },
  warn: {
    wrap: "bg-warn-soft text-warn",
    dot:  "bg-warn",
  },
};

export function StatusBadge({ tone = "active", children, className = "" }: Props) {
  const t = tones[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 " +
        "text-[11px] font-bold leading-tight " +
        t.wrap + " " + className
      }
    >
      <span className={"inline-block w-1.5 h-1.5 rounded-full " + t.dot} />
      {children}
    </span>
  );
}
