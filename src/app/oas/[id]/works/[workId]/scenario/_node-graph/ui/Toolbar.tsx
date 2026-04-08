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

const btnBase: React.CSSProperties = {
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
      role="toolbar"
      aria-label="グラフ操作ツールバー"
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
        style={btnBase}
        title="自動整形（縦型）"
        aria-label="自動整形（縦型）"
      >
        ↕ 自動整形
      </button>
      <button
        onClick={() => onAutoLayout("LR")}
        style={btnBase}
        title="自動整形（横型）"
        aria-label="自動整形（横型）"
      >
        ↔ 横型
      </button>

      <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} aria-hidden="true" />

      <button
        onClick={onFitView}
        style={btnBase}
        title="全体を表示"
        aria-label="全体を表示"
      >
        ⊡ 全体表示
      </button>

      <div style={{ width: 1, background: "#e2e8f0", margin: "0 2px" }} aria-hidden="true" />

      <button
        onClick={canUndo ? onUndo : undefined}
        disabled={!canUndo}
        style={{ ...btnBase, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? "pointer" : "not-allowed" }}
        title="元に戻す (Ctrl+Z)"
        aria-label="元に戻す"
        aria-disabled={!canUndo}
      >
        ↶ 戻す
      </button>
      <button
        onClick={canRedo ? onRedo : undefined}
        disabled={!canRedo}
        style={{ ...btnBase, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? "pointer" : "not-allowed" }}
        title="やり直す (Ctrl+Shift+Z)"
        aria-label="やり直す"
        aria-disabled={!canRedo}
      >
        ↷ やり直す
      </button>
    </div>
  );
}
