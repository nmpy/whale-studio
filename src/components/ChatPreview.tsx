// src/components/ChatPreview.tsx
// 擬似 LINE トーク UI — 吹き出し / 既読 / typing / loading を描画する

"use client";

import type { CSSProperties } from "react";

// ────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────

/** 吹き出しの本体表示種別。未指定なら "text"。
 *  実際の LINE メッセージ種別 (image / video / voice / carousel / puzzle 等) を
 *  簡易表示するためのヒント。description / placeholder で代替する種別もある。 */
export type ChatBubbleType =
  | "text"
  | "image"
  | "video"
  | "voice"
  | "carousel"
  | "other";

/** QR チップ (= プレビューで吹き出し下に表示するボタン)。
 *  実際の onClick は何もしない (= 表示のみ)。 */
export interface ChatQuickReply {
  label: string;
  /** action 種別を視覚的に区別したい場合に渡す (= 現状未使用 / 将来用)。 */
  action?: string;
}

export interface ChatBubble {
  id: string;
  /** "user" = 右側, "bot" = 左側, "system" = 中央寄せのシステム通知（入室/退室/通話など） */
  from: "user" | "bot" | "system";
  text: string;
  /** 既読表示するか（user 発話のみ。system では無視される） */
  read?: boolean;
  /** 吹き出しの種別。"text" 以外は media 系として簡易描画する。 */
  bubbleType?: ChatBubbleType;
  /** bubbleType = "image" / "video" のとき表示する media URL。 */
  mediaUrl?: string;
  /** カルーセルの枚数 (= bubbleType = "carousel" のときの placeholder 用)。 */
  carouselCount?: number;
  /** この吹き出しの直下に表示する QuickReply チップ群。
   *  通常は chain tail にのみ載せる (= 実送信時の moveQuickReplyToTail に合わせる)。 */
  quickReplies?: ChatQuickReply[];
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

const systemRow: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "4px 0",
};

const systemChip: CSSProperties = {
  display: "inline-block",
  background: "rgba(255,255,255,0.85)",
  color: "#555",
  fontSize: 11,
  lineHeight: 1.4,
  padding: "4px 12px",
  borderRadius: 999,
  maxWidth: "80%",
  textAlign: "center",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
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

// media (image / video) を吹き出しの中に直接置くときのスタイル。
const mediaWrap: CSSProperties = {
  maxWidth: 200,
  borderRadius: 12,
  overflow: "hidden",
  background: "#fff",
  boxShadow: "0 1px 1px rgba(0,0,0,0.06)",
};

const mediaImg: CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  maxHeight: 220,
  objectFit: "contain",
  background: "#f3f4f6",
};

const mediaPlaceholder: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 14px",
  background: "#fff",
  borderRadius: 12,
  fontSize: 12,
  color: "#374151",
  boxShadow: "0 1px 1px rgba(0,0,0,0.06)",
};

// QR チップ行 (= chain tail の下に並べる)。横スクロール可。
const qrRow: CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 4,
  overflowX: "auto",
  paddingBottom: 2,
};

const qrChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 12px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.95)",
  border: "1px solid rgba(255,255,255,0.6)",
  color: "#2F6F5E",
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

// ────────────────────────────────────────────────
// コンポーネント
// ────────────────────────────────────────────────

function renderBubbleContent(b: ChatBubble) {
  const t = b.bubbleType ?? "text";
  if (t === "image") {
    if (b.mediaUrl) {
      return (
        <div style={mediaWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.mediaUrl} alt={b.text || "画像"} style={mediaImg} />
        </div>
      );
    }
    return <div style={mediaPlaceholder}>🖼 画像{b.text ? `（${b.text}）` : ""}</div>;
  }
  if (t === "video") {
    return <div style={mediaPlaceholder}>🎬 動画{b.mediaUrl ? "" : " (未設定)"}</div>;
  }
  if (t === "voice") {
    return <div style={mediaPlaceholder}>🎤 音声{b.mediaUrl ? "" : " (未設定)"}</div>;
  }
  if (t === "carousel") {
    return <div style={mediaPlaceholder}>🃏 カルーセル ({b.carouselCount ?? 0} 枚)</div>;
  }
  return <div style={bubbleStyle(b.from === "user" ? "user" : "bot")}>{b.text}</div>;
}

export function ChatPreview({ state }: { state: ChatPreviewState }) {
  return (
    <div style={containerStyle}>
      {state.bubbles.map((b, i) => {
        if (b.from === "system") {
          return (
            <div key={b.id} style={systemRow}>
              <div style={systemChip}>{b.text}</div>
            </div>
          );
        }
        // 直後 (i+1) に bot 系の吹き出しが続かないかつ自分自身に QR が設定されている場合のみ
        // QR チップ行を描画する。chain tail でのみ表示する想定。
        const isLastBot =
          b.from === "bot" &&
          (b.quickReplies?.length ?? 0) > 0 &&
          !state.bubbles.slice(i + 1).some((nb) => nb.from === "bot");
        return (
          <div key={b.id} style={{ display: "flex", flexDirection: "column", alignItems: b.from === "user" ? "flex-end" : "flex-start" }}>
            <div style={bubbleRow(b.from)}>
              {b.from === "user" && b.read && <span style={readLabel}>既読</span>}
              {b.bubbleType && b.bubbleType !== "text" ? renderBubbleContent(b) : (
                <div style={bubbleStyle(b.from)}>{b.text}</div>
              )}
            </div>
            {isLastBot && b.quickReplies && (
              <div style={qrRow}>
                {b.quickReplies.map((qr, qi) => (
                  <span key={qi} style={qrChip}>{qr.label}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}

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
