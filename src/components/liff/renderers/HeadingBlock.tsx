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
//
// 上品な読み物に寄せるため、letter-spacing を見出し用に少し詰める (-0.01em)。
// 本文 (TextBlock) は逆に letter-spacing をやや広めに取っている。
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

  // 見出しは letter-spacing をやや詰め、本文 (0.02em) とコントラストを付ける。
  const headingStyle: React.CSSProperties = { letterSpacing: "-0.005em" };

  switch (level) {
    case 1: return <h1 className={baseCls} style={headingStyle}>{text}</h1>;
    case 2: return <h2 className={baseCls} style={headingStyle}>{text}</h2>;
    case 3: return <h3 className={baseCls} style={headingStyle}>{text}</h3>;
    case 4: return <h4 className={baseCls} style={headingStyle}>{text}</h4>;
    case 5: return <h5 className={baseCls} style={headingStyle}>{text}</h5>;
  }
}

/** 既存データ (level: 1|2|3) との互換のため、想定外の値は 2 に丸める。 */
function clampLevel(raw: unknown): LiffHeadingLevel {
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5) return raw;
  return 2;
}
