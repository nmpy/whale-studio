"use client";

// _node-graph/edges/ScenarioEdge.tsx — カスタムエッジ（ラベル・色分け・ホバー）

import { memo, useState } from "react";
import {
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import type { ScenarioEdgeData } from "../layout/compute-elements";
import { getEdgeBadge } from "../analysis/graph-analysis";

type ScenarioEdge = Edge<ScenarioEdgeData, "scenarioEdge">;

function ScenarioEdgeComponent({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition, targetPosition,
  data,
  selected,
}: EdgeProps<ScenarioEdge>) {
  const [hovered, setHovered] = useState(false);

  const le = data!.layoutEdge;
  const isLoop = data!.isLoop;
  const isInPath = data!.isInPath;
  const badge = getEdgeBadge(le);

  const isTrans = le.kind === "phase-transition";
  const isMsg = le.kind === "qr-message";

  // 色の決定
  let strokeColor = isTrans
    ? (isLoop ? "#f59e0b" : "#94a3b8")
    : isMsg ? "#c2410c" : "#7c3aed";
  let strokeWidth = isTrans
    ? (le.isDefault ? 2.5 : 1.5)
    : 1.8;
  let dashArray: string | undefined = isTrans && !le.isDefault ? "5 3" : undefined;
  let opacity = isTrans ? (le.isDefault ? 0.75 : 0.6) : 0.8;

  if (isLoop) {
    strokeColor = "#f59e0b";
    opacity = 0.85;
  }

  // パスハイライト
  if (isInPath) {
    strokeColor = "#2563eb";
    strokeWidth = 3;
    opacity = 1;
    dashArray = undefined;
  }

  // ホバー・選択時の視覚差を強化
  if (selected) {
    strokeWidth = Math.max(strokeWidth, 3.5);
    opacity = 1;
    strokeColor = "#2563eb";
  } else if (hovered) {
    strokeWidth = Math.max(strokeWidth, 2.8);
    opacity = 1;
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition, targetPosition,
  });

  // ラベル幅: 最小幅50px、パディング厚め
  const labelW = Math.min(140, Math.max(50, badge.text.length * 7.5 + 22));

  return (
    <>
      {/* インタラクションヒットエリア（透明・太い） */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: isTrans ? "pointer" : "default" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* 実際のエッジパス */}
      <path
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        strokeOpacity={opacity}
        markerEnd={`url(#${id}-arrow)`}
        style={{ pointerEvents: "none", transition: "stroke-width 0.12s, stroke-opacity 0.12s" }}
      />

      {/* マーカー定義 */}
      <defs>
        <marker
          id={`${id}-arrow`}
          markerWidth={10}
          markerHeight={8}
          refX={9}
          refY={4}
          orient="auto"
        >
          <path d="M0 0 L10 4 L0 8 Z" fill={strokeColor} fillOpacity={opacity} />
        </marker>
      </defs>

      {/* ラベル */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
            cursor: isTrans ? "pointer" : "default",
            zIndex: hovered || selected ? 10 : 1,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          role={isTrans ? "button" : undefined}
          tabIndex={isTrans ? 0 : undefined}
          aria-label={isTrans ? `遷移: ${le.label}` : undefined}
        >
          <div
            style={{
              background: isInPath || selected ? "#eff6ff" : hovered ? "#f8fafc" : badge.bg,
              border: `1px solid ${isInPath || selected ? "#93c5fd" : hovered ? "#94a3b8" : badge.borderColor}`,
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 10,
              fontWeight: isInPath || selected ? 700 : 600,
              color: isInPath || selected ? "#1d4ed8" : badge.color,
              whiteSpace: "nowrap",
              boxShadow: hovered || selected
                ? "0 2px 8px rgba(0,0,0,0.12)"
                : "0 1px 3px rgba(0,0,0,0.06)",
              transition: "box-shadow 0.12s, background 0.12s, border-color 0.12s",
              maxWidth: labelW,
              minWidth: 50,
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "center",
            }}
            title={le.label}
          >
            {badge.text}
          </div>

          {/* ホバー時の詳細ツールチップ */}
          {hovered && (le.condition || le.flagCondition || le.label.length > 12) && (
            <div
              role="tooltip"
              style={{
                position: "absolute",
                top: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                marginTop: 6,
                background: "#1f2937",
                color: "white",
                fontSize: 11,
                padding: "6px 10px",
                borderRadius: 8,
                pointerEvents: "none",
                zIndex: 50,
                maxWidth: 240,
                boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                lineHeight: 1.6,
              }}
            >
              {le.label.length > 12 && (
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{le.label}</div>
              )}
              {le.condition && (
                <div style={{ color: "#93c5fd" }}>🔑 {le.condition}</div>
              )}
              {le.flagCondition && (
                <div style={{ color: "#c4b5fd" }}>⚑ {le.flagCondition}</div>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const ScenarioEdge = memo(ScenarioEdgeComponent);
