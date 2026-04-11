"use client";

// src/app/admin/page.tsx
// スタジオ管理トップ — 運営管理機能への導線

import Link from "next/link";

const ADMIN_ITEMS = [
  {
    href:  "/admin/announcements",
    title: "お知らせ管理",
    desc:  "ユーザーへのお知らせの作成・公開・非公開を管理",
    color: "#2563eb",
  },
  {
    href:  "/admin/documents",
    title: "ドキュメント管理",
    desc:  "利用ガイド PDF のアップロード・管理",
    color: "#7c3aed",
  },
  {
    href:  null,
    title: "利用規約管理",
    desc:  "利用規約の編集・公開（近日公開）",
    color: "#6b7280",
  },
  {
    href:  null,
    title: "プライバシーポリシー管理",
    desc:  "プライバシーポリシーの編集・公開（近日公開）",
    color: "#6b7280",
  },
  {
    href:  "/admin/billing",
    title: "課金分析",
    desc:  "課金導線イベントの分析・確認",
    color: "#d97706",
  },
  {
    href:  "/admin/audit",
    title: "操作ログ",
    desc:  "管理操作の履歴を確認",
    color: "#059669",
  },
] as const;

export default function AdminIndexPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h2>スタジオ管理</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            プラットフォーム全体の運営管理
          </p>
        </div>
        <Link href="/oas" style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "7px 16px", fontSize: 12, fontWeight: 600,
          color: "var(--text-secondary)", background: "var(--surface)",
          border: "1px solid var(--border-light)", borderRadius: 8,
          textDecoration: "none",
        }}>
          ← アカウントリストへ
        </Link>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 12,
      }}>
        {ADMIN_ITEMS.map(({ href, title, desc, color }) => {
          const isDisabled = !href;

          const cardStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "16px 18px",
            background: isDisabled ? "var(--gray-50, #fafafa)" : "#fff",
            border: "1px solid var(--border-light, #e5e5e5)",
            borderRadius: 10,
            textDecoration: "none",
            color: "inherit",
            opacity: isDisabled ? 0.6 : 1,
            cursor: isDisabled ? "default" : "pointer",
            transition: isDisabled ? "none" : "border-color .15s, box-shadow .15s, transform .1s",
          };

          const hoverIn = (e: React.MouseEvent<HTMLElement>) => {
            const el = e.currentTarget;
            el.style.borderColor = color;
            el.style.boxShadow = "0 2px 8px rgba(0,0,0,.08)";
            el.style.transform = "translateY(-1px)";
          };
          const hoverOut = (e: React.MouseEvent<HTMLElement>) => {
            const el = e.currentTarget;
            el.style.borderColor = "var(--border-light, #e5e5e5)";
            el.style.boxShadow = "none";
            el.style.transform = "translateY(0)";
          };

          const inner = (
            <>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: isDisabled ? "#9ca3af" : "#111827",
                  marginBottom: 2, display: "flex", alignItems: "center", gap: 6,
                }}>
                  {title}
                  {isDisabled && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: "#9ca3af",
                      background: "#f3f4f6", border: "1px solid #e5e7eb",
                      borderRadius: 4, padding: "1px 5px",
                    }}>
                      近日公開
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.45 }}>
                  {desc}
                </div>
              </div>
              {!isDisabled && (
                <span style={{
                  marginLeft: "auto", fontSize: 14, color: "#9ca3af",
                  flexShrink: 0, alignSelf: "center",
                }}>
                  →
                </span>
              )}
            </>
          );

          return isDisabled ? (
            <div key={title} style={cardStyle}>{inner}</div>
          ) : (
            <Link
              key={title}
              href={href}
              style={cardStyle}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </>
  );
}
