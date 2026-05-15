"use client";

import type { TextSettings } from "@/types";
import { textWeightClass } from "../liff-style-helpers";

// LINE Design System の Body Text 階層に揃える:
//   - 本文: 15px / line-height 1.8 / letter-spacing 0.02em (上品な読み物用)
//   - 補足ラベル (title): 12px / 補助色 (大文字感を出さず控えめに)
//   - 太さ: settings.font_weight (normal / medium / bold) で選択可能。
//           旧 settings.emphasis="strong" は font_weight 未指定時に bold 相当として扱う。
export function TextBlock({ title, settings }: { title?: string | null; settings: TextSettings }) {
  const weightCls = textWeightClass(settings);
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && (
        <h3 className="text-[12px] font-semibold mb-1.5 tracking-wide text-[color:var(--liff-tertiary-text)] break-words">
          {title}
        </h3>
      )}
      <p
        className={`text-[15px] leading-[1.8] whitespace-pre-wrap break-words text-[color:var(--liff-primary-text)] ${weightCls}`}
        style={{ letterSpacing: "0.02em" }}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
