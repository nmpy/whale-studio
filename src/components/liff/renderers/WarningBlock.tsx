"use client";

import type { WarningSettings } from "@/types";

const TONE_STYLES: Record<NonNullable<WarningSettings["tone"]>, { bg: string; fg: string; icon: string }> = {
  spoiler: { bg: "bg-yellow-100", fg: "text-yellow-900", icon: "⚠️" },
  info:    { bg: "bg-blue-50",    fg: "text-blue-900",   icon: "ℹ️" },
  danger:  { bg: "bg-red-100",    fg: "text-red-900",    icon: "🚫" },
};

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const style = TONE_STYLES[tone];
  return (
    <div
      className={`${style.bg} ${style.fg} px-4 py-3 rounded-lg text-sm leading-relaxed flex gap-2 items-start break-words`}
      role="note"
    >
      <span aria-hidden="true" className="shrink-0">{style.icon}</span>
      <p className="whitespace-pre-wrap font-semibold">{settings.body}</p>
    </div>
  );
}
