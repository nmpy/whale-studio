"use client";

// scenario/_flow/FlowEdge.tsx
// 接続線（ベジェ）＋条件ラベル。トーン（ok/ng/warn/muted）で配色し、色に依存せずラベルテキストも表示。

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from "@xyflow/react";
import { EDGE_TONE_COLOR, type EdgeTone } from "./constants";

export type FlowEdgeType = Edge<{ label: string; tone: EdgeTone }, "flowEdge">;

function FlowEdgeImpl({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected,
}: EdgeProps<FlowEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const tone: EdgeTone = data?.tone ?? "muted";
  const c = EDGE_TONE_COLOR[tone];
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: c.stroke, strokeWidth: selected ? 2.4 : 1.6 }} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6,
              background: c.bg, color: c.text, border: `1px solid ${c.border}`,
              pointerEvents: "none", whiteSpace: "nowrap",
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
