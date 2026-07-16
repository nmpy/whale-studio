"use client";

// scenario/_flow/FlowPhaseNode.tsx
// フェーズを表すカード型ノード（読み取り専用ビュー）。ハンドオフ A 案準拠。
//   - 左アクセントバー（種別色）/ 種別バッジ / 分岐数 / メッセージ件数（緑）/ 有効・下書き
//   - 開始 / 終了 / 未接続 バッジ / 編集・削除ボタン（既存処理を再利用・パン開始を抑止）
//   - キーボードフォーカス可能・種別＋名前を含む aria-label

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { FlowNodeData } from "./build-graph";
import { PHASE_ACCENT, FLOW_NODE_W } from "./constants";
import { useFlowActions } from "./context";

export type PhaseFlowNode = Node<FlowNodeData, "phaseNode">;

function Badge({ text, bg, color }: { text: string; bg: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: bg, color, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function FlowPhaseNodeImpl({ data, selected }: NodeProps<PhaseFlowNode>) {
  const { onEdit, onDelete, direction, canEdit } = useFlowActions();
  const meta = PHASE_ACCENT[data.phaseType] ?? PHASE_ACCENT.normal;
  const targetPos = direction === "TB" ? Position.Top : Position.Left;
  const sourcePos = direction === "TB" ? Position.Bottom : Position.Right;

  // クリック/ドラッグでキャンバスのパン・選択が始まらないよう伝播を止める。
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const ariaLabel = `${meta.label}フェーズ ${data.name}` +
    (data.isStart ? "（開始）" : "") + (data.isEnding ? "（終了）" : "") + (data.isUnconnected ? "（未接続）" : "") + (data.isDraft ? "（下書き）" : "");

  return (
    <div
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEdit(data.id, data.name); } }}
      style={{
        width: FLOW_NODE_W,
        boxSizing: "border-box",
        background: "#ffffff",
        border: `1px solid ${selected ? meta.accent : "#ECEEF1"}`,
        borderLeft: `5px solid ${meta.accent}`,
        borderRadius: 14,
        boxShadow: selected ? `0 0 0 2px ${meta.accent}55, 0 2px 10px rgba(0,0,0,.08)` : "0 2px 10px rgba(0,0,0,.07)",
        padding: "10px 12px",
        outlineOffset: 2,
      }}
    >
      <Handle type="target" position={targetPos} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={sourcePos} style={{ opacity: 0, pointerEvents: "none" }} />

      {/* バッジ行 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 6 }}>
        <Badge text={meta.label} bg={meta.badgeBg} color={meta.badgeText} />
        {data.branchCount > 1 && <Badge text={`${data.branchCount}分岐`} bg="#F0E8FF" color="#7C3AED" />}
        {data.isStart && <Badge text="開始" bg="#dcfce7" color="#15803d" />}
        {data.isEnding && <Badge text="終了" bg="#F5F5F5" color="#777" />}
        {data.isUnconnected && <Badge text="未接続" bg="#fef2f2" color="#dc2626" />}
        {data.isDraft && <Badge text="下書き" bg="#f3f4f6" color="#6b7280" />}
      </div>

      {/* タイトル */}
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1f2937", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word" }}>
        {data.name || "（無題のフェーズ）"}
      </div>

      {/* メタ + 操作 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
        <div style={{ fontSize: 11, color: "#06A047", fontWeight: 600, whiteSpace: "nowrap" }}>
          {data.msgCount} msgs
          <span style={{ color: data.isDraft ? "#9ca3af" : "#6b7280", fontWeight: 500 }}> ・ {data.isDraft ? "下書き" : "有効"}</span>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              aria-label={`フェーズ「${data.name}」を編集`}
              onMouseDown={stop}
              onClick={(e) => { stop(e); onEdit(data.id, data.name); }}
              className="nodrag nopan"
              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #DFE1E5", background: "#fff", color: "#555", cursor: "pointer" }}
            >
              編集
            </button>
            <button
              type="button"
              aria-label={`フェーズ「${data.name}」を削除`}
              onMouseDown={stop}
              onClick={(e) => { stop(e); onDelete(data.id, data.name); }}
              className="nodrag nopan"
              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #C0705A", background: "#FDF4F4", color: "#8B4A4A", cursor: "pointer" }}
            >
              削除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const FlowPhaseNode = memo(FlowPhaseNodeImpl);
