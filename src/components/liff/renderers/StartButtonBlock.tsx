"use client";

import { useState } from "react";
import type { StartButtonSettings } from "@/types";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "@/components/liff/LiffPlayerContext";
import { LiffButton, normalizeLiffButtonVariant } from "@/components/liff/primitives";

// 謎解き開始ボタン。LiffButton (既定 variant=primary) を使う。
// settings.button_variant があればそれを優先し、未設定/不正値は primary にフォールバック。
// Primary CTA としての見た目 (LINE Primary Green / 48px / 角丸 10px) は LiffButton に集約済み。
export function StartButtonBlock({
  settings,
  onStart,
}: {
  settings: StartButtonSettings;
  onStart?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(!settings.confirm_message);
  const playerCtx = useLiffPlayerContext();

  const handleClick = async () => {
    if (playerCtx && !playerCtx.preview) {
      recordLiffEvent({
        workId:     playerCtx.workId,
        pageId:     playerCtx.pageId,
        lineUserId: playerCtx.lineUserId,
        eventType:  "button_click",
        metadata:   { source: "start_button", label: settings.label ?? "作品を始める" },
      });
    }
    if (!confirmed && settings.confirm_message) {
      if (!window.confirm(settings.confirm_message)) return;
      setConfirmed(true);
    }
    if (onStart) {
      setLoading(true);
      try {
        await onStart();
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <LiffButton
      variant={normalizeLiffButtonVariant(settings.button_variant, "primary")}
      onClick={handleClick}
      loading={loading}
      loadingLabel="処理中..."
    >
      {settings.label || "作品を始める"}
    </LiffButton>
  );
}
