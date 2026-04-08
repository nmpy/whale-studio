"use client";

import type { FreeTextSettings } from "@/types";

export function FreeTextBlock({ title, settings }: { title?: string | null; settings: FreeTextSettings }) {
  return (
    <div className={`${settings.align === "center" ? "text-center" : "text-left"}`}>
      {title && <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>}
      <p
        className={`text-sm text-gray-700 whitespace-pre-wrap ${settings.emphasis === "strong" ? "font-bold text-gray-900" : ""}`}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
