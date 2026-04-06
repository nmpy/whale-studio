"use client";

// src/components/HelpAccordion.tsx
// 画面ごとの説明アコーディオン
//
// 使い方:
//   import { HelpAccordion } from "@/components/HelpAccordion";
//   <HelpAccordion items={[
//     { icon: "✅", title: "できること", points: ["…", "…"] },
//     { icon: "👆", title: "操作手順",   points: ["…"] },
//   ]} />

import { useState } from "react";

export interface HelpItem {
  icon?:  string;
  title:  string;
  points: string[];
}

interface Props {
  items:        HelpItem[];
  defaultOpen?: boolean;
}

export function HelpAccordion({ items, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background:   "#f8faff",
      border:       "1px solid #dbeafe",
      borderRadius: 10,
      marginBottom: 20,
      overflow:     "hidden",
    }}>
      {/* ── ヘッダー ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "11px 16px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
          borderBottom: open ? "1px solid #dbeafe" : "none",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "#1d4ed8", flex: 1 }}>
          この画面の使い方
        </span>
        <span style={{
          fontSize: 11, color: "#93c5fd",
          display: "inline-block",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
        }}>
          ▼
        </span>
      </button>

      {/* ── 本文 ── */}
      <div style={{
        overflow: "hidden",
        maxHeight: open ? "800px" : "0",
        transition: "max-height 0.25s ease",
      }}>
        <div style={{
          padding: "14px 16px 16px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
        }}>
          {items.map((item, i) => (
            <div key={i} style={{
              background:    "rgba(239, 246, 255, 0.55)",
              border:        "1px solid rgba(219, 234, 254, 0.8)",
              borderRadius:  8,
              padding:       "10px 12px 12px",
            }}>
              {/* セクション見出し — カード背景 + 下線 + ドットで区切りを明確に */}
              <p style={{
                fontWeight:    700,
                fontSize:      12,
                color:         "#1e40af",
                marginBottom:  8,
                paddingBottom: 6,
                borderBottom:  "1px solid rgba(219, 234, 254, 0.9)",
                display:       "flex",
                alignItems:    "center",
                gap:           6,
              }}>
                <span style={{
                  display:      "inline-block",
                  width:        5,
                  height:       5,
                  borderRadius: "50%",
                  background:   "#3b82f6",
                  flexShrink:   0,
                }} aria-hidden="true" />
                {item.title}
              </p>
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {item.points.map((pt, j) => (
                  <li key={j} style={{ fontSize: 12, color: "#374151", lineHeight: 1.75, marginBottom: 4 }}>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
