"use client";

import { useState } from "react";
import type { StartButtonSettings } from "@/types";

export function StartButtonBlock({
  settings,
  onStart,
}: {
  settings: StartButtonSettings;
  onStart?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(!settings.confirm_message);

  const handleClick = async () => {
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
      className="w-full py-3 px-4 rounded-lg text-white font-semibold text-sm transition-opacity disabled:opacity-50"
      style={{ background: "#06C755" }}
    >
      {loading ? "処理中..." : (settings.label || "謎解きを始める")}
    </button>
  );
}
