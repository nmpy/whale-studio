"use client";

import type { TextSettings } from "@/types";
import { textWeightClass } from "../liff-style-helpers";

// LINE Design System の Body Text 階層に揃える:
//   - 本文: 15px / line-height 1.6 (LIFF root が 1.6 を継承する)
//   - 補足ラベル (title): 13px / 補助色
//   - 太さ: settings.font_weight (normal / medium / bold) で選択可能。
//           旧 settings.emphasis="strong" は font_weight 未指定時に bold 相当として扱う。
export function TextBlock({ title, settings }: { title?: string | null; settings: TextSettings }) {
  const weightCls = textWeightClass(settings);
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && (
        <h3 className="text-[13px] font-bold mb-1 text-[color:var(--liff-secondary-text)] break-words">
          {title}
        </h3>
      )}
      <p
        className={`text-[15px] leading-[1.6] whitespace-pre-wrap break-words text-[color:var(--liff-primary-text)] ${weightCls}`}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
