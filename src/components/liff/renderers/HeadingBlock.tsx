"use client";

import type { HeadingSettings, LiffHeadingLevel } from "@/types";
import { headingSizeClass, headingWeightClass } from "../liff-style-helpers";

// LINE Design System の Typography に合わせた階層 (h1〜h5):
//   level=1 → 22px / bold (ページ大見出し相当)
//   level=2 → 20px / bold (デフォルト)
//   level=3 → 18px / bold
//   level=4 → 16px / bold (本文相当の強調)
//   level=5 → 14px / bold (小見出し)
// 太さは settings.font_weight で normal / medium / bold を選べる (既定 bold)。
export function HeadingBlock({
  title,
  settings,
}: {
  title?: string | null;
  settings: HeadingSettings;
}) {
  const text = settings.text || title || "";
  if (!text) return null;

  const align = settings.align === "center" ? "text-center" : "text-left";
  const level = clampLevel(settings.level);
  const sizeCls = headingSizeClass(level);
  const weightCls = headingWeightClass(settings);
  const colorCls = "text-[color:var(--liff-primary-text)]";
  const baseCls = `${sizeCls} ${weightCls} ${align} ${colorCls} break-words`;

  switch (level) {
    case 1: return <h1 className={baseCls}>{text}</h1>;
    case 2: return <h2 className={baseCls}>{text}</h2>;
    case 3: return <h3 className={baseCls}>{text}</h3>;
    case 4: return <h4 className={baseCls}>{text}</h4>;
    case 5: return <h5 className={baseCls}>{text}</h5>;
  }
}

/** 既存データ (level: 1|2|3) との互換のため、想定外の値は 2 に丸める。 */
function clampLevel(raw: unknown): LiffHeadingLevel {
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5) return raw;
  return 2;
}
