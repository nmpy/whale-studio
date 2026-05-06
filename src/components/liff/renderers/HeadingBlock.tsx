"use client";

import type { HeadingSettings } from "@/types";

export function HeadingBlock({ title, settings }: { title?: string | null; settings: HeadingSettings }) {
  const text = settings.text || title || "";
  if (!text) return null;
  const align = settings.align === "center" ? "text-center" : "text-left";
  const level = settings.level ?? 2;
  const cls = level === 1
    ? "text-2xl font-extrabold tracking-tight"
    : level === 3
      ? "text-base font-bold"
      : "text-xl font-bold";
  if (level === 1) return <h1 className={`${cls} ${align} text-gray-900 break-words`}>{text}</h1>;
  if (level === 3) return <h3 className={`${cls} ${align} text-gray-900 break-words`}>{text}</h3>;
  return <h2 className={`${cls} ${align} text-gray-900 break-words`}>{text}</h2>;
}
