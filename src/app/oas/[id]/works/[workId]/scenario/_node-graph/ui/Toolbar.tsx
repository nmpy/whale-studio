"use client";

// _node-graph/ui/Toolbar.tsx — ツールバー（自動整形・Fit View・Undo/Redo）

import type { LayoutDirection } from "../layout/dagre-layout";

interface ToolbarProps {
  onAutoLayout: (direction: LayoutDirection) => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const btnStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "5px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "white",
  color: "#475569",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
  whiteSpace: "nowrap",
};

const disabledStyle: React.CSSProperties = {
  ...btnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

export function Toolbar({
  onAutoLayout,
  onFitView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: 14,
        display: "flex",
        gap: 6,
        zIndex: 10,
      }}
    >
      <button
        onClick={() => onAutoLayout("TB")}
        style={btnStyle}
        title="自動整形（縦型）"
      >
        ↕ 自動整形
      </button>
      <button
        onClick={() => onAutoLayout("LR")}
        style={btnStyle}
        title="自動整形（横型）"
      >
        ↔ 横型
      </button>

      <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} />

      <button
        onClick={onFitView}
        style={btnStyle}
        title="全体を表示"
      >
        ⊡ 全体表示
      </button>

      <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} />

      <button
        onClick={canUndo ? onUndo : undefined}
        style={canUndo ? btnStyle : disabledStyle}
        title="元に戻す (Ctrl+Z)"
      >
        ↶ 戻す
      </button>
      <button
        onClick={canRedo ? onRedo : undefined}
        style={canRedo ? btnStyle : disabledStyle}
        title="やり直す (Ctrl+Shift+Z)"
      >
        ↷ やり直す
      </button>
    </div>
  );
}
