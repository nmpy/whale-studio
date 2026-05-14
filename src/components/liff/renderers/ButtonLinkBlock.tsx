"use client";

import type { ButtonLinkSettings, LiffSectionVariant } from "@/types";
import { trackHintSiteEvent } from "@/lib/liff-analytics";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "@/components/liff/LiffPlayerContext";
import { LiffButton, type LiffButtonVariant } from "@/components/liff/primitives";

interface Props {
  settings: ButtonLinkSettings;
  /** ブロックの DB 行 ID。LiffRenderer から渡る。 */
  blockId?: string;
}

// 既存 settings.variant (default / dark / purple) を LiffButton のバリアントに対応付ける:
//   - default → outline (補助導線, Primary Green の枠)
//   - dark    → dark (Filled dark, 強い視覚優先度)
//   - purple  → legacy: LiffButton には乗せず、互換のためインライン <a> で描画する
// 主要 CTA (謎解き開始など) は StartButtonBlock 側の variant=primary を使う。
const VARIANT_MAP: Partial<Record<LiffSectionVariant, LiffButtonVariant>> = {
  default: "outline",
  dark:    "dark",
};

// purple は LIFF Design System に乗せない (旧アクセント色)。
// 既存データを壊さないため、purple だけは従来の className でインライン描画する。
const PURPLE_LEGACY_CLS =
  "flex items-center justify-center w-full h-12 px-4 rounded-[10px] text-[15px] font-bold tracking-tight " +
  "bg-violet-600 text-white border border-violet-600 active:bg-violet-700 transition-colors";

export function ButtonLinkBlock({ settings, blockId }: Props) {
  const playerCtx = useLiffPlayerContext();
  if (!settings.url || !settings.label) return null;

  const variant = (settings.variant ?? "default") as LiffSectionVariant;
  const target = settings.open_external ? "_blank" : undefined;
  const rel    = settings.open_external ? "noopener noreferrer" : undefined;

  const handleClick = () => {
    trackHintSiteEvent("cta_click", { url: settings.url, label: settings.label, source: "block" });
    if (playerCtx && !playerCtx.preview) {
      recordLiffEvent({
        workId:     playerCtx.workId,
        pageId:     playerCtx.pageId,
        blockId,
        lineUserId: playerCtx.lineUserId,
        eventType:  "button_click",
        metadata:   {
          source:        "button_link",
          label:         settings.label,
          url:           settings.url,
          open_external: !!settings.open_external,
        },
      });
    }
  };

  // 旧 purple 互換パス
  if (variant === "purple") {
    return (
      <a
        href={settings.url}
        target={target}
        rel={rel}
        className={PURPLE_LEGACY_CLS}
        onClick={handleClick}
      >
        {settings.label}
      </a>
    );
  }

  const liffVariant = VARIANT_MAP[variant] ?? "outline";
  return (
    <LiffButton
      as="a"
      href={settings.url}
      target={target}
      rel={rel}
      variant={liffVariant}
      onClick={handleClick}
    >
      {settings.label}
    </LiffButton>
  );
}
