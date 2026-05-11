"use client";

import { useState } from "react";
import type { ResumeButtonSettings } from "@/types";

// LINE Design System の Outline (secondary) ボタン相当として描画する。
// 再開は破壊的でも主要 CTA でもないため、Primary Green とは視覚優先度を変える。
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

  const handleClick = async () => {
    if (!canResume || !onResume) return;
    setLoading(true);
    try {
      await onResume();
    } finally {
      setLoading(false);
    }
  };

  if (!canResume) return null;

  return (
    <button
      onClick={handleClick}
      disabled={loading || !canResume}
      className="w-full h-12 px-4 rounded-[10px] font-bold text-[15px] tracking-tight transition-opacity disabled:opacity-50 active:opacity-90 bg-[color:var(--liff-surface)] border border-[color:var(--liff-line-green)] text-[color:var(--liff-line-green)]"
    >
      {loading ? "処理中..." : (settings.label || "途中から再開する")}
    </button>
  );
}
