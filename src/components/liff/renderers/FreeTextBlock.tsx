"use client";

import type { FreeTextSettings } from "@/types";

export function FreeTextBlock({ title, settings }: { title?: string | null; settings: FreeTextSettings }) {
  return (
    <div className={`${settings.align === "center" ? "text-center" : "text-left"}`}>
      {title && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {title}
        </h3>
      )}
      <p
        className={`text-[15px] leading-[1.6] whitespace-pre-wrap text-[color:var(--liff-primary-text)] break-words ${
          settings.emphasis === "strong" ? "font-bold" : ""
        }`}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
