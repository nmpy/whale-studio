"use client";

// src/app/oas/[id]/works/[workId]/locations/_tabs.tsx
//
// 「ロケーション」配下の GPS / ビーコン / QR タブ UI。
// 純粋ロジックは _tabs-config.ts に切り出し、本ファイルは React コンポーネントに専念する。

import Link from "next/link";
import {
  LOCATION_TABS,
  type LocationTab,
} from "./_tabs-config";

export {
  LOCATION_TABS,
  isValidLocationTab,
  resolveLocationTab,
  type LocationTab,
} from "./_tabs-config";

interface Props {
  oaId: string;
  workId: string;
  activeTab: LocationTab;
}

export function LocationTabs({ oaId, workId, activeTab }: Props) {
  const base = `/oas/${oaId}/works/${workId}/locations`;
  const activeMeta = LOCATION_TABS.find((t) => t.key === activeTab);
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        role="tablist"
        aria-label="ロケーション種別"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid #e5e7eb",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        {LOCATION_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          const href = tab.key === "gps" ? base : `${base}?tab=${tab.key}`;
          return (
            <Link
              key={tab.key}
              href={href}
              role="tab"
              aria-selected={isActive}
              data-tab={tab.key}
              data-active={isActive ? "true" : "false"}
              style={{
                padding: "8px 18px",
                fontSize: 13,
                fontWeight: 600,
                color: isActive ? "#2563eb" : "#6b7280",
                background: "transparent",
                borderBottom: isActive ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: -1,
                textDecoration: "none",
                cursor: "pointer",
                transition: "color 0.12s, border-color 0.12s",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {activeMeta && (
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>
          {activeMeta.description}
        </p>
      )}
    </div>
  );
}
