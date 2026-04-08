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

const SEVERITY_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  error:   { bg: "#fef2f2", border: "#fecaca", color: "#991b1b" },
  warning: { bg: "#fffbeb", border: "#fde68a", color: "#78350f" },
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
  const hasErrors = errors.some(e => e.severity === "error");

  if (errors.length === 0 && !showEndingWarning && !showNoStartWarning) {
    return null;
  }

  const style = hasErrors ? SEVERITY_STYLE.error : SEVERITY_STYLE.warning;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 8,
        padding: "8px 14px",
        marginBottom: 8,
        fontSize: 12,
        color: style.color,
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
            <button
              key={err.phaseId}
              onClick={() => onFocusNode(err.phaseId)}
              role="button"
              tabIndex={0}
              aria-label={`${err.message} — クリックしてフォーカス`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                background: "none",
                border: "none",
                padding: "2px 0",
                color: "inherit",
                fontSize: "inherit",
                textAlign: "left",
              }}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onFocusNode(err.phaseId); }}
            >
              <span aria-hidden="true">{STATUS_ICON[err.status] ?? "⚠"}</span>
              <span style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>
                {err.message}
              </span>
              {err.severity === "error" && (
                <span style={{
                  fontSize: 9, fontWeight: 700,
                  background: "#fecaca", color: "#991b1b",
                  borderRadius: 3, padding: "0 4px",
                }}>
                  エラー
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
