"use client";

// _node-graph/nodes/PhaseNode.tsx — カスタムフェーズノード

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type { PhaseNodeData, PhaseAnalytics } from "../layout/compute-elements";
import { PHASE_META } from "../constants";
import type { PhaseType } from "@/types";
import { useDirection } from "../hooks/use-direction-context";
import { useDisplayMode } from "../hooks/use-display-mode";

type PhaseNode = Node<PhaseNodeData, "phaseNode">;

// バッジ優先順位: disconnected > no-condition > loop > ok
const STATUS_BADGE: Record<string, { icon: string; bg: string; color: string; tip: string; label: string }> = {
  disconnected:    { icon: "⚠",  bg: "#fff7ed", color: "#ea580c", tip: "スタートから到達不可",   label: "到達不可" },
  "no-condition":  { icon: "❗", bg: "#fefce8", color: "#ca8a04", tip: "条件未設定の遷移あり",   label: "条件未設定" },
  loop:            { icon: "🔁", bg: "#fffbeb", color: "#d97706", tip: "ループ遷移あり",         label: "ループ" },
  ok:              { icon: "✓",  bg: "#f0fdf4", color: "#16a34a", tip: "正常",                   label: "正常" },
};

// ── 分析バッジ（PhaseNode から分離して整理） ────────
function AnalyticsBadges({ analytics }: { analytics?: PhaseAnalytics }) {
  if (!analytics) return null;
  const { visitCount, dropoffRate } = analytics;
  const hasAny = typeof visitCount === "number" || typeof dropoffRate === "number";
  if (!hasAny) return null;

  return (
    <span style={{ display: "inline-flex", gap: 4, marginLeft: 4 }}>
      {typeof visitCount === "number" && (
        <span
          title={`訪問数: ${visitCount}`}
          style={{
            fontSize: 9, fontWeight: 700,
            background: visitCount > 50 ? "#dbeafe" : visitCount > 10 ? "#e0f2fe" : "#f0f9ff",
            color: visitCount > 50 ? "#1e40af" : "#0369a1",
            borderRadius: 3, padding: "0 4px", lineHeight: "16px",
          }}
        >
          {visitCount}回
        </span>
      )}
      {typeof dropoffRate === "number" && (
        <span
          title={`離脱率: ${dropoffRate}%`}
          style={{
            fontSize: 9, fontWeight: 700,
            background: dropoffRate > 30 ? "#fef2f2" : "#f0fdf4",
            color: dropoffRate > 30 ? "#991b1b" : "#166534",
            borderRadius: 3, padding: "0 4px", lineHeight: "16px",
          }}
        >
          {dropoffRate}%
        </span>
      )}
    </span>
  );
}

function PhaseNodeComponent({ data, selected }: NodeProps<PhaseNode>) {
  const direction = useDirection();
  const displayMode = useDisplayMode();
  const isCompact = displayMode === "compact";
  const meta = PHASE_META[(data.phaseType as PhaseType)] ?? PHASE_META.normal;
  const badge = STATUS_BADGE[data.status] ?? STATUS_BADGE.ok;
  const isError = data.status !== "ok";

  const targetPos = direction === "TB" ? Position.Top : Position.Left;
  const sourcePos = direction === "TB" ? Position.Bottom : Position.Right;

  return (
    <div
      data-testid="phase-node"
      data-phase-id={data.phaseId}
      data-status={data.status}
      style={{
        width: "100%",
        height: "100%",
        background: data.bg,
        border: isError
          ? `2.5px solid ${badge.color}`
          : selected
          ? "3px solid #2563eb"
          : `2px solid ${data.border}`,
        borderLeft: `5px solid ${data.color}`,
        borderRadius: 12,
        padding: isCompact ? "6px 10px" : "10px 14px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxShadow: selected
          ? "0 0 0 4px rgba(37,99,235,0.15), 0 4px 16px rgba(0,0,0,0.1)"
          : data.isInPath
          ? "0 0 0 2px #93c5fd, 0 2px 10px rgba(0,0,0,0.08)"
          : "0 2px 10px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        cursor: "grab",
        position: "relative",
      }}
      aria-label={`フェーズ: ${data.label} (${meta.label}) — ${badge.label}`}
    >
      {/* ステータスバッジ */}
      {(isError || (data.status === "ok" && selected)) && (
        <div
          data-testid="status-badge"
          title={badge.tip}
          aria-label={badge.label}
          style={{
            position: "absolute",
            top: -8, right: -8,
            width: 22, height: 22,
            borderRadius: "50%",
            background: badge.bg,
            border: `1.5px solid ${badge.color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, lineHeight: 1, zIndex: 10,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            animation: isError ? "badge-pulse 2s ease-in-out infinite" : undefined,
          }}
        >
          <span aria-hidden="true">{badge.icon}</span>
        </div>
      )}

      {/* 1行目: フェーズ種別 + メッセージ数 + 分析 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isCompact ? 2 : 5 }}>
        <span
          data-testid="phase-type-badge"
          style={{
            fontSize: isCompact ? 9 : 10, fontWeight: 700, color: meta.color,
            background: meta.bg, border: `1px solid ${meta.border}`,
            borderRadius: 4, padding: "1px 7px", whiteSpace: "nowrap",
            letterSpacing: "0.04em",
          }}
        >
          {meta.label}
        </span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{data.messageCount}件</span>
        {!isCompact && <AnalyticsBadges analytics={data.analytics} />}
      </div>

      {/* タイトル */}
      <div
        data-testid="phase-title"
        style={{
          fontSize: isCompact ? 12 : 14, fontWeight: 700, color: "#111827",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          lineHeight: 1.3,
        }}
        title={data.label}
      >
        {data.label}
      </div>

      {/* サブラベル — compact 時は非表示 */}
      {!isCompact && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
          {data.sublabel}
        </div>
      )}

      {/* Handles */}
      <Handle type="target" position={targetPos}
        style={{ width: 10, height: 10, background: data.color, border: "2px solid white", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
      <Handle type="source" position={sourcePos}
        style={{ width: 10, height: 10, background: data.color, border: "2px solid white", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />

      <style>{`
        @keyframes badge-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}

export const PhaseNode = memo(PhaseNodeComponent);
