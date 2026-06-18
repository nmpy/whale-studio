"use client";

import { useState } from "react";
import type { ResumeButtonSettings } from "@/types";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "@/components/liff/LiffPlayerContext";
import { LiffButton, normalizeLiffButtonVariant } from "@/components/liff/primitives";

// 再開ボタン。LiffButton (既定 variant=outline) を使う。
// settings.button_variant があればそれを優先し、未設定/不正値は outline にフォールバック。
// 再開は破壊的でも主要 CTA でもないため Primary Green とは視覚優先度を変える。
export function ResumeButtonBlock({
  settings,
  canResume,
  onResume,
}: {
  settings: ResumeButtonSettings;
  canResume: boolean;
  onResume?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const playerCtx = useLiffPlayerContext();

  const handleClick = async () => {
    if (!canResume || !onResume) return;
    if (playerCtx && !playerCtx.preview) {
      recordLiffEvent({
        workId:     playerCtx.workId,
        pageId:     playerCtx.pageId,
        lineUserId: playerCtx.lineUserId,
        eventType:  "button_click",
        metadata:   { source: "resume_button", label: settings.label ?? "途中から再開する" },
      });
    }
    setLoading(true);
    try {
      await onResume();
    } finally {
      setLoading(false);
    }
  };

  if (!canResume) return null;

  return (
    <LiffButton
      variant={normalizeLiffButtonVariant(settings.button_variant, "outline")}
      onClick={handleClick}
      loading={loading}
      loadingLabel="処理中..."
      disabled={!canResume}
    >
      {settings.label || "途中から再開する"}
    </LiffButton>
  );
}
