"use client";

import type { WarningSettings } from "@/types";

// ブロック単位のネタバレ / 注意 / 危険警告。
// 親ブロック (LiffRenderer / HintSiteRenderer / AccordionBlock) からのみ表示される。
// ページ全体の共通ネタバレ警告は廃止し、ここで完結する。
const TONE_STYLES: Record<NonNullable<WarningSettings["tone"]>, { bg: string; fg: string; icon: string; border: string }> = {
  spoiler: { bg: "bg-yellow-50",  fg: "text-yellow-900",  icon: "⚠️", border: "border-yellow-200" },
  info:    { bg: "bg-blue-50",    fg: "text-blue-900",    icon: "ℹ️", border: "border-blue-200"   },
  danger:  { bg: "bg-red-50",     fg: "text-red-900",     icon: "🚫", border: "border-red-200"    },
};

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const style = TONE_STYLES[tone];
  return (
    <div
      className={`${style.bg} ${style.fg} ${style.border} border rounded-[12px] px-4 py-3 text-[14px] leading-[1.6] flex gap-2 items-start break-words`}
      role="note"
    >
      <span aria-hidden="true" className="shrink-0">{style.icon}</span>
      <p className="whitespace-pre-wrap font-bold">{settings.body}</p>
    </div>
  );
}
