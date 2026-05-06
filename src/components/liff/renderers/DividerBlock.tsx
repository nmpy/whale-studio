"use client";

import type { DividerSettings } from "@/types";

export function DividerBlock({ settings }: { settings: DividerSettings }) {
  const style = settings.style === "dashed" ? "border-dashed" : "border-solid";
  return <hr className={`my-2 border-t ${style} border-gray-300`} aria-hidden="true" />;
}
