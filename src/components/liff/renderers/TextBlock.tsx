"use client";

import type { TextSettings } from "@/types";
import { textWeightClass } from "../liff-style-helpers";

// LINE Gift like 本文表示:
//   - 本文: 15px / line-height 1.85 / letter-spacing 0.01em
//   - 補足ラベル (title): 13px / 補助色 / 上下控えめな余白
//   - 太さ既定: normal (400)。設定で medium / bold を選べる
//     (旧 settings.emphasis="strong" は font_weight 未指定時に bold 扱い、互換)
//
// 段落間の余白は親の `gap` で取る (TextBlock 自体は <p> 1 つ)。
export function TextBlock({ title, settings }: { title?: string | null; settings: TextSettings }) {
  const weightCls = textWeightClass(settings);
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && (
        <p className="text-[12px] font-semibold mb-2 tracking-wide text-[color:var(--liff-tertiary-text)] break-words">
          {title}
        </p>
      )}
      <p
        className={`liff-body-text text-[15px] leading-[1.85] whitespace-pre-wrap break-words text-[color:var(--liff-body-color,var(--liff-primary-text))] ${weightCls}`}
        style={{ letterSpacing: "0.01em" }}
      >
        {settings.body || ""}
      </p>
    </div>
  );
}
