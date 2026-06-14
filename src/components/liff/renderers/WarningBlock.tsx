"use client";

import type { WarningSettings } from "@/types";

// ブロック単位のネタバレ / 注意 / 危険警告。
// 親ブロック (LiffRenderer / HintSiteRenderer / AccordionBlock) からのみ表示される。
//
// 新仕様: 長方形のベタ塗りカラー背景 + 黒テキスト。左ボーダー / 左の影 / box-shadow /
//        アクセント装飾は付けない。角丸は軽め (rounded-lg)。
const TONE_BG: Record<NonNullable<WarningSettings["tone"]>, string> = {
  spoiler: "bg-[#FDE68A]", // amber-200（ネタバレ注意）
  info:    "bg-[#BAE6FD]", // sky-200（補足情報）
  danger:  "bg-[#FECACA]", // red-200（強い注意）
};

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const bg = TONE_BG[tone] ?? TONE_BG.spoiler;
  return (
    <div
      className={`${bg} text-[#111827] rounded-lg px-4 py-3 text-[14px] leading-[1.7] break-words`}
      role="note"
    >
      <p className="whitespace-pre-wrap font-bold">{settings.body}</p>
    </div>
  );
}
