"use client";

// src/app/admin/_components/AdminSidebar.tsx
// 管理エリアサイドバー（Client Component）
// usePathname はクライアントでのみ使えるため、このコンポーネントを分離する。

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleAdminNavItems } from "./adminNavItems";

export function AdminSidebar({ isPlatform = false }: { isPlatform?: boolean }) {
  const pathname = usePathname();

  // FV（/admin トップ）と共通の定義から描画する（adminNavItems.ts が唯一の定義）。
  // platformOnly 項目は isPlatform=true のときのみ表示。ページ自体の server gate はそのまま維持。
  const navItems = visibleAdminNavItems(isPlatform);

  return (
    <aside style={{
      width:      200,
      flexShrink: 0,
      paddingTop: 8,
    }}>
      {/* 管理エリアタイトル */}
      <div style={{
        fontSize:      11,
        fontWeight:    700,
        color:         "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding:       "6px 10px",
        marginBottom:  4,
      }}>
        Admin
      </div>

      <nav>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display:        "flex",
                alignItems:     "center",
                gap:            8,
                padding:        "8px 10px",
                borderRadius:   8,
                fontSize:       13,
                fontWeight:     active ? 700 : 400,
                color:          active ? "var(--color-primary, #2F6F5E)" : "var(--text-secondary)",
                background:     active ? "var(--color-primary-bg, #f0fdf4)" : "transparent",
                textDecoration: "none",
                transition:     "background .1s, color .1s",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "var(--color-bg-subtle, #f7f7f7)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* OA一覧に戻る */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-light)" }}>
        <Link
          href="/oas"
          style={{
            display:        "flex",
            alignItems:     "center",
            gap:            6,
            padding:        "6px 10px",
            fontSize:       12,
            color:          "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          ← アカウントリストへ
        </Link>
      </div>
    </aside>
  );
}
