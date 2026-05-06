"use client";

import type { TextSettings } from "@/types";

export function TextBlock({ title, settings }: { title?: string | null; settings: TextSettings }) {
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && <h3 className="text-sm font-semibold mb-1 text-gray-900 break-words">{title}</h3>}
      <p
        className={`text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words ${
          settings.emphasis === "strong" ? "font-bold text-gray-900" : ""
        }`}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
