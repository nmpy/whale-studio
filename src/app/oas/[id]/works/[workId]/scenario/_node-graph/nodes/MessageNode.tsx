"use client";

// _node-graph/nodes/MessageNode.tsx — カスタムメッセージノード

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type { MessageNodeData } from "../layout/compute-elements";
import { useDirection } from "../hooks/use-direction-context";

type MessageNode = Node<MessageNodeData, "messageNode">;

function MessageNodeComponent({ data, selected }: NodeProps<MessageNode>) {
  const direction = useDirection();
  const targetPos = direction === "TB" ? Position.Top : Position.Left;
  const sourcePos = direction === "TB" ? Position.Bottom : Position.Right;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#fff",
        border: selected ? "2.5px solid #2563eb" : `1.5px solid ${data.border}`,
        borderLeft: `3.5px solid ${data.color}`,
        borderRadius: 8,
        padding: "7px 11px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxShadow: selected
          ? "0 0 0 3px rgba(37,99,235,0.12), 0 2px 8px rgba(0,0,0,0.08)"
          : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        cursor: "grab",
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: data.color, letterSpacing: "0.04em", marginBottom: 3 }}>
        {data.sublabel}
      </div>
      <div
        style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}
        title={data.label}
      >
        {data.label}
      </div>

      <Handle type="target" position={targetPos}
        style={{ width: 8, height: 8, background: data.color, border: "2px solid white", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
      />
      <Handle type="source" position={sourcePos}
        style={{ width: 8, height: 8, background: data.color, border: "2px solid white", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
      />
    </div>
  );
}

export const MessageNode = memo(MessageNodeComponent);
