"use client";

// src/components/AppHeader.tsx
// グローバルヘッダー。フィードバックボタンを右上に常設。

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

// FeedbackModal は大きいので dynamic import でコード分割
const FeedbackModal = dynamic(() => import("@/components/FeedbackModal"), { ssr: false });

export default function AppHeader() {
  const pathname = usePathname();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // サポートエリアなど外部コンポーネントからモーダルを開けるようにする
  useEffect(() => {
    const handler = () => setFeedbackOpen(true);
    window.addEventListener("open-feedback-modal", handler);
    return () => window.removeEventListener("open-feedback-modal", handler);
  }, []);

  return (
    <>
      <header>
        <div className="container">
          <h1>
            <a href="/">
              <span className="header-brand">WHALE STUDIO</span>
              <span className="header-sep">|</span>
              <span className="header-sub">LINEでつくる物語体験 β版</span>
            </a>
          </h1>

          {/* ── フィードバックボタン ── */}
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 13px",
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
              background: "#f3f4f6",
              border: "1.5px solid #e5e7eb",
              borderRadius: 20,
              cursor: "pointer",
              transition: "background 0.15s, border-color 0.15s",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background  = "#e5e7eb";
              e.currentTarget.style.borderColor = "#d1d5db";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background  = "#f3f4f6";
              e.currentTarget.style.borderColor = "#e5e7eb";
            }}
            aria-label="フィードバックを送る"
          >
            <span style={{ fontSize: 14 }}>💬</span>
            フィードバック
          </button>
        </div>
      </header>

      {/* フィードバックモーダル（開いているときのみマウント） */}
      {feedbackOpen && (
        <FeedbackModal
          pathname={pathname}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </>
  );
}
