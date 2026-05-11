"use client";

import type { HeadingSettings } from "@/types";

// LINE Design System の Typography に合わせた階層:
//   level=1 → ページタイトル相当 (20px / bold)
//   level=2 → ブロックタイトル (18px / bold)
//   level=3 → サブヘディング     (16px / bold)
export function HeadingBlock({ title, settings }: { title?: string | null; settings: HeadingSettings }) {
  const text = settings.text || title || "";
  if (!text) return null;
  const align = settings.align === "center" ? "text-center" : "text-left";
  const level = settings.level ?? 2;
  const cls = level === 1
    ? "text-[20px] leading-tight font-bold tracking-tight"
    : level === 3
      ? "text-[16px] leading-snug font-bold"
      : "text-[18px] leading-snug font-bold";
  const colorCls = "text-[color:var(--liff-primary-text)]";
  if (level === 1) return <h1 className={`${cls} ${align} ${colorCls} break-words`}>{text}</h1>;
  if (level === 3) return <h3 className={`${cls} ${align} ${colorCls} break-words`}>{text}</h3>;
  return <h2 className={`${cls} ${align} ${colorCls} break-words`}>{text}</h2>;
}
