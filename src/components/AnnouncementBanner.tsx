"use client";

// src/components/AnnouncementBanner.tsx
// アカウント一覧ページ上部に表示するお知らせエリア。
// 最新順で最大 3 件表示。important なものは先頭に浮かせる。
// 将来: ANNOUNCEMENTS を GET /api/announcements に差し替えるだけで DB 連携可能。

import { useState } from "react";
import { ANNOUNCEMENTS, type Announcement, type AnnouncementType } from "@/data/announcements";

const TYPE_META: Record<AnnouncementType, {
  label: string; icon: string; bg: string; color: string; border: string;
}> = {
  update:      { label: "アップデート", icon: "🎉", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  bugfix:      { label: "不具合修正",   icon: "🔧", bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  known_issue: { label: "既知の不具合", icon: "⚠️", bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  info:        { label: "お知らせ",     icon: "📢", bg: "#f9fafb", color: "#374151", border: "#e5e7eb" },
};

const IMPORTANT_OVERRIDE = {
  bg: "#fef2f2", color: "#991b1b", border: "#fecaca", icon: "🚨",
};

function AnnouncementItem({ item }: { item: Announcement }) {
  const [expanded, setExpanded] = useState(false);
  const meta = item.important
    ? { ...TYPE_META[item.type], ...IMPORTANT_OVERRIDE }
    : TYPE_META[item.type];

  const body = item.body.length > 100 && !expanded
    ? item.body.slice(0, 100) + "…"
    : item.body;

  return (
    <div style={{
      display: "flex",
      gap: 12,
      padding: "11px 16px",
      background: meta.bg,
      border: `1px solid ${meta.border}`,
      borderLeft: item.important ? `4px solid ${meta.color}` : `1px solid ${meta.border}`,
      borderRadius: 8,
    }}>
      <span style={{ fontSize: 17, flexShrink: 0, lineHeight: 1.5 }}>{meta.icon}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ヘッダー行: バッジ・日付・タイトル */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          flexWrap: "wrap", marginBottom: 3,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: meta.color,
            background: "rgba(255,255,255,0.65)",
            border: `1px solid ${meta.border}`,
            padding: "1px 7px", borderRadius: 10,
            letterSpacing: "0.04em", flexShrink: 0,
          }}>
            {meta.label}
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>
            {item.date}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: item.important ? meta.color : "#111827",
          }}>
            {item.title}
          </span>
        </div>

        {/* 本文 */}
        <p style={{ fontSize: 12, color: "#374151", lineHeight: 1.7, margin: 0 }}>
          {body}
          {item.body.length > 100 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                marginLeft: 6, fontSize: 11, color: "#6b7280",
                background: "none", border: "none", cursor: "pointer",
                padding: 0, textDecoration: "underline",
              }}
            >
              {expanded ? "閉じる" : "続きを読む"}
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

export function AnnouncementBanner() {
  const [collapsed, setCollapsed] = useState(false);

  // 重要を先頭、その後は日付降順。最大 3 件
  const sorted = [...ANNOUNCEMENTS]
    .sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      return b.date.localeCompare(a.date);
    })
    .slice(0, 3);

  if (sorted.length === 0) return null;

  const importantCount = sorted.filter((a) => a.important).length;

  return (
    <section style={{ marginBottom: 24 }}>
      {/* セクションヘッダー */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: collapsed ? 0 : 10,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: 0 }}>
          📋 お知らせ
        </h3>
        {importantCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: "#991b1b", background: "#fef2f2",
            border: "1px solid #fecaca",
            padding: "1px 6px", borderRadius: 10,
          }}>
            重要 {importantCount}件
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            marginLeft: "auto", fontSize: 11, color: "#9ca3af",
            background: "none", border: "none", cursor: "pointer",
            padding: "2px 6px",
          }}
        >
          {collapsed ? "▼ 表示する" : "▲ 閉じる"}
        </button>
      </div>

      {/* お知らせ一覧 */}
      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((item) => (
            <AnnouncementItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
