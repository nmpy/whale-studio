"use client";

// src/components/WorkCard.tsx
//
// 作品リストの1枚カード。
// /oas/[id]/works/page.tsx と tester/[oaId]/works/page.tsx で共用。
//
// Props:
//   work       — 作品データ
//   oaId       — OA ID（リンク生成に使用）
//   basePath   — カードの href ベース。例:
//                  "/oas/${oaId}/works"  (管理画面)
//                  "/tester/${oaId}/works" (テスター)
//   role       — ワークスペース権限（管理画面のみ）。省略時は削除ボタン非表示
//   onDelete   — 削除ハンドラ（管理画面のみ）

import { useState } from "react";
import Link from "next/link";
import { STATUS_META } from "@/constants/workStatus";
import type { WorkListItem } from "@/lib/api-client";

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

interface WorkCardProps {
  work:      WorkListItem;
  oaId:      string;
  basePath:  string;               // e.g. "/oas/abc123/works" or "/tester/abc123/works"
  role?:     string | null;
  onDelete?: (id: string, title: string) => void;
}

export function WorkCard({ work, oaId, basePath, role, onDelete }: WorkCardProps) {
  const [hovered, setHovered] = useState(false);
  const st = STATUS_META[work.publish_status] ?? STATUS_META.draft;

  const workHref    = `${basePath}/${work.id}`;
  const previewHref = `/playground?work_id=${work.id}&oa_id=${oaId}`;

  return (
    <div
      style={{
        background:  "var(--surface)",
        border:      `1px solid ${hovered ? "var(--gray-300)" : "var(--border-light)"}`,
        borderRadius:"var(--radius-md)",
        padding:     "20px 22px",
        boxShadow:   hovered ? "var(--shadow-md)" : "var(--shadow-xs)",
        transition:  "border-color 0.15s, box-shadow 0.15s",
        position:    "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── ヘッダー行 ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        {/* 状態バッジ（ドット付き） */}
        <span style={{
          display:    "inline-flex",
          alignItems: "center",
          gap:        5,
          fontSize:   11,
          fontWeight: 700,
          color:      st.color,
          background: st.bg,
          padding:    "3px 9px",
          borderRadius: "var(--radius-full)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot, display: "inline-block" }} />
          {st.label}
        </span>

        {/* タイトル */}
        <Link
          href={workHref}
          style={{
            fontSize:       15,
            fontWeight:     700,
            color:          "var(--text-primary)",
            textDecoration: "none",
            flex:           1,
            lineHeight:     1.3,
          }}
        >
          {work.title}
        </Link>

        {/* アクション */}
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <Link
            href={workHref}
            className="btn btn-primary"
            style={{ padding: "5px 14px", fontSize: 12 }}
          >
            管理する
          </Link>
          <Link
            href={previewHref}
            className="btn btn-ghost"
            style={{ padding: "5px 12px", fontSize: 12 }}
          >
            ▶ プレビュー
          </Link>
          {role === "owner" && onDelete && (
            <button
              className="btn btn-danger"
              style={{ padding: "5px 10px", fontSize: 12 }}
              onClick={() => onDelete(work.id, work.title)}
            >
              削除
            </button>
          )}
        </div>
      </div>

      {/* ── メタ情報チップ ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { icon: "👥", value: (work._count.userProgress ?? 0).toLocaleString(), label: "プレイヤー",   highlight: (work._count.userProgress ?? 0) > 0 },
          { icon: "🗂",  value: work._count.phases,                              label: "フェーズ",     highlight: false },
          { icon: "💬", value: work._count.messages,                             label: "メッセージ",   highlight: false },
          { icon: "🎭", value: work._count.characters,                           label: "キャラクター", highlight: false },
        ].map((chip) => (
          <span key={chip.label} style={{
            display:    "inline-flex",
            alignItems: "center",
            gap:        4,
            fontSize:   11,
            color:      chip.highlight ? "var(--color-info)" : "var(--text-secondary)",
            background: chip.highlight ? "#eff6ff" : "var(--gray-50)",
            border:     `1px solid ${chip.highlight ? "#bfdbfe" : "var(--border-light)"}`,
            padding:    "3px 10px",
            borderRadius: "var(--radius-full)",
          }}>
            <span>{chip.icon}</span>
            <strong style={{ fontWeight: 700 }}>{chip.value}</strong>
            <span style={{ color: "var(--text-muted)" }}>{chip.label}</span>
          </span>
        ))}

        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
          更新: {formatDate(work.updated_at)}
        </span>
      </div>
    </div>
  );
}
