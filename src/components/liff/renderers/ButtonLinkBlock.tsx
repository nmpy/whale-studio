"use client";

import type { ButtonLinkSettings, LiffSectionVariant } from "@/types";
import { trackHintSiteEvent } from "@/lib/liff-analytics";

const VARIANT_CLASSES: Record<LiffSectionVariant, string> = {
  default: "bg-white text-gray-900 border border-gray-900 hover:bg-gray-50",
  dark:    "bg-gray-900 text-white border border-gray-900 hover:bg-gray-800",
  purple:  "bg-violet-600 text-white border border-violet-600 hover:bg-violet-700",
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
      className={`block w-full text-center px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${cls}`}
      onClick={() => trackHintSiteEvent("cta_click", { url: settings.url, label: settings.label, source: "block" })}
    >
      {settings.label}
    </a>
  );
}
