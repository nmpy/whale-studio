// src/components/liff/hint-search/SpoilerBadge.tsx
//
// ヒント段階の「ネタバレ度」表示。●○○ / ●●○ / ●●● のドット + ラベル。
// 段階番号から機械的に決まる（保存値ではない）ので、CMS 側の設定項目は増やさない。
//
// 色だけで強さを伝えないよう、必ず「低 / 中 / 高」の文字を併記する。

import type { HintSpoilerLevel } from "@/types";
import { cx } from "../ui/tokens";
import { HINT_SEARCH_COPY as C } from "./copy";

const LEVEL_TEXT: Record<HintSpoilerLevel, string> = {
  low:    C.spoilerLow,
  medium: C.spoilerMedium,
  high:   C.spoilerHigh,
};

const FILLED: Record<HintSpoilerLevel, number> = { low: 1, medium: 2, high: 3 };

export function SpoilerBadge({ level }: { level: HintSpoilerLevel }) {
  const filled = FILLED[level];
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cx(
              "block h-[6px] w-[6px] rounded-full",
              i < filled
                ? "bg-[color:var(--liff-line-green,#06C755)]"
                : "bg-[color:var(--liff-border-strong,#E0E2E5)]",
            )}
          />
        ))}
      </span>
      <span className="text-[11px] text-[color:var(--liff-tertiary-text,#8C8C8C)] whitespace-nowrap">
        {C.spoilerLabel} {LEVEL_TEXT[level]}
      </span>
    </span>
  );
}
