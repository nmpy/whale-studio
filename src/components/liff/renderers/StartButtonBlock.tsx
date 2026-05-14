"use client";

import { useState } from "react";
import type { StartButtonSettings } from "@/types";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "@/components/liff/LiffPlayerContext";

// LINE Design System の Box Button (Primary) に準拠。
// - 背景: LINE Primary Green (#06C755)
// - 文字: #FFFFFF (緑背景の上で十分なコントラストを持つ既存仕様)
// - 高さ: 48px、横幅: 100%、角丸: 10px
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
        metadata:   { source: "start_button", label: settings.label ?? "謎解きを始める" },
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
    <button
      onClick={handleClick}
      disabled={loading}
      className="w-full h-12 px-4 rounded-[10px] text-white font-bold text-[15px] tracking-tight transition-opacity disabled:opacity-50 active:opacity-90"
      style={{ background: "var(--liff-line-green, #06C755)" }}
    >
      {loading ? "処理中..." : (settings.label || "謎解きを始める")}
    </button>
  );
}
