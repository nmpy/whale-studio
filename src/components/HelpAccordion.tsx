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
  icon:   string;
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
        <span style={{ fontSize: 15 }}>❓</span>
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
          gap: 14,
        }}>
          {items.map((item, i) => (
            <div key={i}>
              <p style={{ fontWeight: 600, fontSize: 12, color: "#1e40af", marginBottom: 5 }}>
                {item.icon} {item.title}
              </p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {item.points.map((pt, j) => (
                  <li key={j} style={{ fontSize: 12, color: "#374151", lineHeight: 1.65, marginBottom: 2 }}>
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
