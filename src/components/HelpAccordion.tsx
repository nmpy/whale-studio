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

  // 控えめな補足情報スタイル (= CTAや警告のように目立たせない / 主要操作ボタンより主張しない)。
  // 既存デザイントークン (ink-2 / ink-3 / line / line-2) に揃え、影は無し。
  return (
    <div style={{
      background:   "#fafafa",         // 白寄りの薄グレー
      border:       "1px solid #e5e7eb", // line 相当の淡いグレー
      borderRadius: 8,
      marginBottom: 20,
      overflow:     "hidden",
    }}>
      {/* ── ヘッダー ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
          borderBottom: open ? "1px solid #f3f4f6" : "none",
        }}
      >
        <span style={{ fontWeight: 500, fontSize: 12, color: "#6b7280", flex: 1 }}>
          この画面の使い方
        </span>
        <span style={{
          fontSize: 10, color: "#9ca3af",
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
          padding: "12px 14px 14px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
        }}>
          {items.map((item, i) => (
            <div key={i} style={{
              background:    "transparent",
              border:        "1px solid #f3f4f6",
              borderRadius:  6,
              padding:       "9px 11px 11px",
            }}>
              {/* セクション見出し — 控えめなドット + 中立色 */}
              <p style={{
                fontWeight:    600,
                fontSize:      11,
                color:         "#6b7280",
                marginBottom:  6,
                paddingBottom: 4,
                borderBottom:  "1px solid #f3f4f6",
                display:       "flex",
                alignItems:    "center",
                gap:           6,
              }}>
                <span style={{
                  display:      "inline-block",
                  width:        4,
                  height:       4,
                  borderRadius: "50%",
                  background:   "#d1d5db",
                  flexShrink:   0,
                }} aria-hidden="true" />
                {item.title}
              </p>
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {item.points.map((pt, j) => (
                  <li key={j} style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.75, marginBottom: 4 }}>
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
