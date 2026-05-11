"use client";

import type { ButtonLinkSettings, LiffSectionVariant } from "@/types";
import { trackHintSiteEvent } from "@/lib/liff-analytics";

// LINE Design System の Box Button に準拠したリンクボタン。
// - default: Outline (Primary Green) — Primary CTA と区別される補助導線として使う
// - dark:    Filled dark — 強い視覚優先度のセカンダリ
// - purple:  Legacy accent — 既存データ互換のため温存
// 主要 CTA（謎解き開始など）は StartButtonBlock 側で Primary Green の塗りボタンを使う。
const VARIANT_CLASSES: Record<LiffSectionVariant, string> = {
  default: "bg-[color:var(--liff-surface)] text-[color:var(--liff-line-green)] border border-[color:var(--liff-line-green)] active:bg-[color:rgba(6,199,85,0.06)]",
  dark:    "bg-[color:var(--liff-primary-text)] text-white border border-[color:var(--liff-primary-text)] active:opacity-90",
  purple:  "bg-violet-600 text-white border border-violet-600 active:bg-violet-700",
};

export function ButtonLinkBlock({ settings }: { settings: ButtonLinkSettings }) {
  if (!settings.url || !settings.label) return null;
  const variant = (settings.variant ?? "default") as LiffSectionVariant;
  const cls = VARIANT_CLASSES[variant];
  const target = settings.open_external ? "_blank" : undefined;
  const rel = settings.open_external ? "noopener noreferrer" : undefined;
  return (
    <a
      href={settings.url}
      target={target}
      rel={rel}
      className={`flex items-center justify-center w-full h-12 px-4 rounded-[10px] text-[15px] font-bold tracking-tight transition-colors ${cls}`}
      onClick={() => trackHintSiteEvent("cta_click", { url: settings.url, label: settings.label, source: "block" })}
    >
      {settings.label}
    </a>
  );
}
