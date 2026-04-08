"use client";

// _node-graph/ui/WarningBanner.tsx — エラー警告バナー

import type { ValidationError } from "../hooks/use-graph-validation";

interface WarningBannerProps {
  errors: ValidationError[];
  hasEndingReachable: boolean;
  hasEnding: boolean;
  hasStart: boolean;
  phaseCount: number;
  onFocusNode: (phaseId: string) => void;
}

const STATUS_ICON: Record<string, string> = {
  disconnected: "⚠",
  "no-condition": "❗",
  loop: "🔁",
};

export function WarningBanner({
  errors,
  hasEndingReachable,
  hasEnding,
  hasStart,
  phaseCount,
  onFocusNode,
}: WarningBannerProps) {
  const showEndingWarning = hasEnding && !hasEndingReachable && phaseCount > 0;
  const showNoStartWarning = !hasStart && phaseCount > 0;

  if (errors.length === 0 && !showEndingWarning && !showNoStartWarning) {
    return null;
  }

  return (
    <div
      style={{
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 8,
        padding: "8px 14px",
        marginBottom: 8,
        fontSize: 12,
        color: "#92400e",
      }}
    >
      {showNoStartWarning && (
        <div style={{ marginBottom: errors.length > 0 ? 6 : 0, display: "flex", alignItems: "center", gap: 6 }}>
          ⚠️ 開始フェーズがありません。シナリオを開始するにはstartフェーズを追加してください。
        </div>
      )}

      {showEndingWarning && (
        <div style={{ marginBottom: errors.length > 0 ? 6 : 0, display: "flex", alignItems: "center", gap: 6 }}>
          ⚠️ スタートからエンディングへ到達できる経路がありません。遷移を設定してください。
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {errors.map(err => (
            <div
              key={err.phaseId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
              onClick={() => onFocusNode(err.phaseId)}
            >
              <span>{STATUS_ICON[err.status] ?? "⚠"}</span>
              <span style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>
                {err.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
