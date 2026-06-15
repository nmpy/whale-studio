"use client";

// src/app/admin/page.tsx
// スタジオ管理トップ — 運営管理機能への導線

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { visibleAdminNavItems } from "./_components/adminNavItems";

export default function AdminIndexPage() {
  // Whale Studio Live 管理カードは platform admin のみに表示（運営専用）。
  // /admin は workspace owner も入れるため、ここで platform 判定して出し分ける。
  const [isPlatform, setIsPlatform] = useState(false);
  useEffect(() => {
    fetch("/api/admin/me", { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.success) setIsPlatform(j.data.is_platform_owner === true); })
      .catch(() => {});
  }, []);

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
        {/* 左サイドバー（AdminSidebar）と共通の定義から描画する（adminNavItems.ts が唯一の定義）。
            platformOnly 項目は isPlatform=true のときのみ表示＝サイドバーと同一の表示条件。 */}
        {visibleAdminNavItems(isPlatform).map(({ href, label, desc, color }) => {
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
                  {label}
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
            <div key={href} style={cardStyle}>{inner}</div>
          ) : (
            <Link
              key={href}
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
