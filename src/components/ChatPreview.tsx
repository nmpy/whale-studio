// src/components/ChatPreview.tsx
// 擬似 LINE トーク UI — 吹き出し / 既読 / typing / loading を描画する

"use client";

import type { CSSProperties } from "react";

// ────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────

export interface ChatBubble {
  id: string;
  /** "user" = 右側, "bot" = 左側 */
  from: "user" | "bot";
  text: string;
  /** 既読表示するか */
  read?: boolean;
}

export interface ChatPreviewState {
  bubbles: ChatBubble[];
  /** typing 中表示 */
  showTyping: boolean;
  /** loading 中表示 */
  showLoading: boolean;
}

// ────────────────────────────────────────────────
// スタイル
// ────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  background: "#7494C0",
  borderRadius: 12,
  padding: "16px 12px",
  minHeight: 260,
  maxHeight: 400,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  fontSize: 14,
};

const bubbleRow = (from: "user" | "bot"): CSSProperties => ({
  display: "flex",
  justifyContent: from === "user" ? "flex-end" : "flex-start",
  alignItems: "flex-end",
  gap: 4,
});

const bubbleStyle = (from: "user" | "bot"): CSSProperties => ({
  maxWidth: "72%",
  padding: "8px 12px",
  borderRadius: from === "user" ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
  background: from === "user" ? "#82DC51" : "#fff",
  color: "#111",
  lineHeight: 1.45,
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
  boxShadow: "0 1px 1px rgba(0,0,0,0.06)",
});

const readLabel: CSSProperties = {
  fontSize: 10,
  color: "#e0e0e0",
  flexShrink: 0,
  alignSelf: "flex-end",
  marginBottom: 2,
};

const typingBubble: CSSProperties = {
  ...bubbleStyle("bot"),
  display: "inline-flex",
  gap: 4,
  padding: "10px 16px",
  alignItems: "center",
};

const dotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "#999",
};

const loadingRow: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "8px 0",
};

const loadingBox: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(255,255,255,0.85)",
  borderRadius: 20,
  padding: "6px 16px",
  fontSize: 12,
  color: "#666",
};

// ────────────────────────────────────────────────
// コンポーネント
// ────────────────────────────────────────────────

export function ChatPreview({ state }: { state: ChatPreviewState }) {
  return (
    <div style={containerStyle}>
      {state.bubbles.map((b) => (
        <div key={b.id} style={bubbleRow(b.from)}>
          {b.from === "user" && b.read && <span style={readLabel}>既読</span>}
          <div style={bubbleStyle(b.from)}>{b.text}</div>
        </div>
      ))}

      {state.showTyping && (
        <div style={bubbleRow("bot")}>
          <div style={typingBubble}>
            <span style={{ ...dotStyle, animation: "chatDot 1.2s infinite 0s" }} />
            <span style={{ ...dotStyle, animation: "chatDot 1.2s infinite 0.2s" }} />
            <span style={{ ...dotStyle, animation: "chatDot 1.2s infinite 0.4s" }} />
          </div>
        </div>
      )}

      {state.showLoading && (
        <div style={loadingRow}>
          <div style={loadingBox}>
            <span className="spinner" style={{ width: 14, height: 14 }} />
            考え中...
          </div>
        </div>
      )}

      {/* typing dot アニメーション */}
      <style>{`
        @keyframes chatDot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
