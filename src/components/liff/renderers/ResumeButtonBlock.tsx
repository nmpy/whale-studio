"use client";

import { useState } from "react";
import type { ResumeButtonSettings } from "@/types";

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
      className="w-full py-3 px-4 bg-blue-500 text-white font-semibold text-sm rounded-lg transition-opacity disabled:opacity-50"
    >
      {loading ? "処理中..." : (settings.label || "途中から再開する")}
    </button>
  );
}
