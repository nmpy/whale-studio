"use client";

// src/components/AnnouncementBanner.tsx
// お知らせ一覧コンポーネント（リスト型UI）
// 将来: ANNOUNCEMENTS を GET /api/announcements に差し替えるだけで DB 連携可能。

import { useState } from "react";
import { ANNOUNCEMENTS, type Announcement, type AnnouncementType } from "@/data/announcements";

// ── 種別メタ情報 ───────────────────────────────────────────────────────────
const TYPE_META: Record<AnnouncementType, { label: string; color: string; bg: string }> = {
  update:      { label: "アップデート", color: "#1d4ed8", bg: "#eff6ff" },
  bugfix:      { label: "不具合修正",   color: "#166534", bg: "#f0fdf4" },
  known_issue: { label: "既知の不具合", color: "#92400e", bg: "#fffbeb" },
  info:        { label: "お知らせ",     color: "#374151", bg: "#f3f4f6" },
};

// ── タブ定義 ──────────────────────────────────────────────────────────────
const TABS: { value: AnnouncementType | "all" | "important"; label: string }[] = [
  { value: "all",       label: "すべて" },
  { value: "update",    label: "アップデート" },
  { value: "bugfix",    label: "不具合修正" },
  { value: "known_issue", label: "既知の不具合" },
  { value: "important", label: "重要" },
];

// ── 日付フォーマット ──────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

// ── 1行アイテム ───────────────────────────────────────────────────────────
function AnnouncementRow({ item, isLast }: { item: Announcement; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[item.type];
  const hasLongBody = item.body.length > 80;
  const displayBody = expanded ? item.body : item.body.slice(0, 80) + (hasLongBody ? "…" : "");

  return (
    <div style={{
      borderBottom: isLast ? "none" : "1px solid var(--color-border-soft, #f0f0f0)",
    }}>
      {/* ── メイン行 ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "13px 20px",
        background: item.important ? "#fffcf5" : "transparent",
        transition: "background .1s",
      }}>
        {/* 日付 */}
        <span style={{
          fontSize: 11,
          color: "var(--color-text-muted, #999)",
          whiteSpace: "nowrap",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          minWidth: 72,
        }}>
          {formatDate(item.date)}
        </span>

        {/* 種別ラベル */}
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: item.important ? "#92400e" : meta.color,
          background: item.important ? "#fef3c7" : meta.bg,
          padding: "2px 8px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          flexShrink: 0,
          minWidth: 80,
          textAlign: "center",
          letterSpacing: "0.04em",
        }}>
          {item.important ? "🚨 重要" : meta.label}
        </span>

        {/* タイトル */}
        <span style={{
          fontSize: 13,
          fontWeight: item.important ? 700 : 500,
          color: item.important ? "#78350f" : "var(--color-text-primary, #1a1a1a)",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {item.title}
        </span>

        {/* 詳細展開ボタン */}
        {hasLongBody && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: "var(--color-text-muted, #999)",
              background: "none",
              border: "1px solid var(--color-border-default, #e5e5e5)",
              borderRadius: 4,
              cursor: "pointer",
              padding: "2px 8px",
              whiteSpace: "nowrap",
              transition: "color .1s, border-color .1s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#374151"; e.currentTarget.style.borderColor = "#9ca3af"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-muted, #999)"; e.currentTarget.style.borderColor = "var(--color-border-default, #e5e5e5)"; }}
          >
            {expanded ? "閉じる ▲" : "詳細 ▼"}
          </button>
        )}
      </div>

      {/* ── 展開：本文 ── */}
      {expanded && (
        <div style={{
          padding: "0 20px 14px",
          paddingLeft: 20 + 72 + 16 + 80 + 16, // date + gap + label + gap
          fontSize: 12,
          color: "#374151",
          lineHeight: 1.75,
        }}>
          {item.body}
        </div>
      )}
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────────────────
export function AnnouncementBanner() {
  const [activeTab, setActiveTab]   = useState<AnnouncementType | "all" | "important">("all");
  const [collapsed, setCollapsed]   = useState(false);

  if (ANNOUNCEMENTS.length === 0) return null;

  // フィルタリング
  const filtered = ANNOUNCEMENTS
    .filter((a) => {
      if (activeTab === "all")       return true;
      if (activeTab === "important") return a.important;
      return a.type === activeTab;
    })
    .sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      return b.date.localeCompare(a.date);
    });

  const importantCount = ANNOUNCEMENTS.filter((a) => a.important).length;

  return (
    <section style={{ marginBottom: 28 }}>
      {/* ── セクションヘッダー ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: collapsed ? 0 : 12,
      }}>
        <h3 style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--color-text-primary, #1a1a1a)",
          margin: 0,
          letterSpacing: "0.02em",
        }}>
          お知らせ
        </h3>
        {importantCount > 0 && (
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#92400e",
            background: "#fef3c7",
            padding: "1px 7px",
            borderRadius: 10,
            border: "1px solid #fde68a",
          }}>
            重要 {importantCount}件
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--color-text-muted, #999)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {collapsed ? "▼ 表示する" : "▲ 閉じる"}
        </button>
      </div>

      {!collapsed && (
        <div style={{
          background: "#fff",
          border: "1px solid var(--color-border-default, #e5e5e5)",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          {/* ── カテゴリタブ ── */}
          <div style={{
            display: "flex",
            gap: 0,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border-soft, #f0f0f0)",
            background: "var(--color-bg-subtle, #f7f7f7)",
            overflowX: "auto",
          }}>
            {TABS.map((tab) => {
              const active = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  style={{
                    padding: "4px 12px",
                    fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    color: active ? "var(--color-primary, #2F6F5E)" : "var(--color-text-muted, #999)",
                    background: active ? "#fff" : "transparent",
                    border: active ? "1px solid var(--color-border-default, #e5e5e5)" : "1px solid transparent",
                    borderRadius: 6,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all .1s",
                    marginRight: 4,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── お知らせ一覧 ── */}
          {filtered.length === 0 ? (
            <div style={{
              padding: "24px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-muted, #999)",
            }}>
              該当するお知らせはありません
            </div>
          ) : (
            <div>
              {filtered.map((item, i) => (
                <AnnouncementRow
                  key={item.id}
                  item={item}
                  isLast={i === filtered.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
