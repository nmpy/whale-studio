"use client";

import type { WarningSettings } from "@/types";
import { resolveWarningIcon, type WarningIconKind } from "../warning-icon";

// ブロック単位のネタバレ / 注意 / 危険警告（CMS 表示名: バナー）。
// 親ブロック (LiffRenderer / HintSiteRenderer / AccordionBlock) からのみ表示される。
//
// PR-BLK4a: tone 別の「淡い色背景 + 左アイコン」に。色は LIFF player 用トークン経由（hex 直書きなし）。
//   - 背景/アクセント = --liff-banner-{warning|info|danger}-bg / -accent（liff-font.css 定義・player専用）。
//   - 本文 = --liff-primary-text。アイコンは tone or settings.icon から導出（icon:"none" で非表示）。
//   - tone 値/意味は不変・新 tone なし・title なし。icon は additive フィールド（未設定=auto）。
const TONE_TOKENS: Record<NonNullable<WarningSettings["tone"]>, { bg: string; accent: string }> = {
  spoiler: { bg: "var(--liff-banner-warning-bg)", accent: "var(--liff-banner-warning-accent)" },
  info:    { bg: "var(--liff-banner-info-bg)",    accent: "var(--liff-banner-info-accent)" },
  danger:  { bg: "var(--liff-banner-danger-bg)",  accent: "var(--liff-banner-danger-accent)" },
};

// アイコンは装飾（aria-hidden）。色は親の color（=accent）を currentColor で受ける。
function BannerIcon({ kind }: { kind: Exclude<WarningIconKind, "none"> }) {
  const common = {
    width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "info") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  }
  if (kind === "alert") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  // warning（三角）
  return (
    <svg {...common}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const t = TONE_TOKENS[tone] ?? TONE_TOKENS.spoiler;
  const iconKind = resolveWarningIcon(tone, settings.icon);

  return (
    <div
      className="flex items-start gap-3 rounded-[12px] px-4 py-3.5 text-[14px] leading-[1.7] break-words text-[color:var(--liff-primary-text)]"
      style={{ background: t.bg }}
      role="note"
    >
      {iconKind !== "none" && (
        <span className="shrink-0 mt-0.5 inline-flex" style={{ color: t.accent }} aria-hidden="true">
          <BannerIcon kind={iconKind} />
        </span>
      )}
      <p className="min-w-0 flex-1 whitespace-pre-wrap">{settings.body}</p>
    </div>
  );
}
