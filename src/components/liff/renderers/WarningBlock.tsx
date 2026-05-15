"use client";

import type { WarningSettings } from "@/types";

// ブロック単位のネタバレ / 注意 / 危険警告。
// 親ブロック (LiffRenderer / HintSiteRenderer / AccordionBlock) からのみ表示される。
//
// 旧仕様: 強い emoji + 鮮やかな yellow / red / blue 背景 → 管理画面的で野暮ったかった。
// 新仕様: 控えめなアクセントカラー + 左ボーダー (4px) のみ。背景は薄い tinted で
//        本文と馴染ませる。emoji は付けず、tone に応じて細い色記号だけ。
const TONE_STYLES: Record<NonNullable<WarningSettings["tone"]>, {
  bg: string; fg: string; accent: string;
}> = {
  // spoiler: 注意喚起 (amber)
  spoiler: {
    bg:     "bg-[color:rgba(245,158,11,0.06)]",   // amber-500 6%
    fg:     "text-[color:#7C5A11]",
    accent: "border-l-[color:#F59E0B]",
  },
  // info: 補足情報 (line-green は強いので落ち着いた teal 系)
  info: {
    bg:     "bg-[color:rgba(15,118,110,0.06)]",   // teal-700 6%
    fg:     "text-[color:#0F766E]",
    accent: "border-l-[color:#14B8A6]",
  },
  // danger: 強い注意 (red)
  danger: {
    bg:     "bg-[color:rgba(220,38,38,0.06)]",    // red-600 6%
    fg:     "text-[color:#9F1F1F]",
    accent: "border-l-[color:#DC2626]",
  },
};

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const style = TONE_STYLES[tone];
  return (
    <div
      className={`${style.bg} ${style.fg} ${style.accent} border-l-[3px] rounded-[12px] px-4 py-3 text-[14px] leading-[1.7] break-words`}
      role="note"
    >
      <p className="whitespace-pre-wrap font-bold">{settings.body}</p>
    </div>
  );
}
