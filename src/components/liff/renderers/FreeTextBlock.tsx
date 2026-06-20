"use client";

import type { FreeTextSettings } from "@/types";
import { resolveFreeTextVariant } from "../free-text-variant";

export function FreeTextBlock({ title, settings }: { title?: string | null; settings: FreeTextSettings }) {
  // PR-BLK4e: "sub"(補足) のみ小さめ・控えめ表示。未設定/不明は "body"（既存表示）。
  const isSub = resolveFreeTextVariant(settings.variant) === "sub";
  return (
    <div className={`${settings.align === "center" ? "text-center" : "text-left"}`}>
      {title && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {title}
        </h3>
      )}
      {isSub ? (
        // 補足: 13px / 控えめ色（--liff-secondary-text）。emphasis(strong) は当てず控えめを維持。
        <p className="text-[13px] leading-[1.7] whitespace-pre-wrap break-words text-[color:var(--liff-secondary-text)]">
          {settings.body || ""}
        </p>
      ) : (
        <p
          className={`text-[14px] leading-[1.85] whitespace-pre-wrap text-[color:var(--liff-primary-text)] break-words ${
            settings.emphasis === "strong" ? "font-bold" : ""
          }`}
        >
          {settings.body || ""}
        </p>
      )}
    </div>
  );
}
