"use client";

// src/app/admin/_components/AdminSidebar.tsx
// 管理エリアサイドバー（Client Component）
// usePathname はクライアントでのみ使えるため、このコンポーネントを分離する。

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/announcements", label: "お知らせ管理",       icon: "📢" },
  { href: "/admin/documents",     label: "ドキュメント",        icon: "📄" },
  { href: "/admin/audience",      label: "ユーザー概況",        icon: "👥" },
  { href: "/admin/onboarding",    label: "オンボーディング分析", icon: "📈" },
  { href: "/admin/billing",       label: "課金導線分析",        icon: "💰" },
  { href: "/admin/audit",         label: "操作ログ",            icon: "📋" },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();

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
        {NAV_ITEMS.map((item) => {
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
              <span style={{ fontSize: 15 }}>{item.icon}</span>
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
