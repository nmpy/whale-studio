"use client";

// src/app/admin/_components/AdminSidebar.tsx
// 管理エリアサイドバー（Client Component）
// usePathname はクライアントでのみ使えるため、このコンポーネントを分離する。

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/announcements", label: "お知らせ管理" },
  { href: "/admin/audience",      label: "ユーザー概況" },
  { href: "/admin/onboarding",    label: "オンボーディング分析" },
  { href: "/admin/billing",       label: "課金導線分析" },
  { href: "/admin/hub-actions",   label: "ハブ操作分析" },
  { href: "/admin/resume",        label: "再開分析" },
  { href: "/admin/audit",         label: "操作ログ" },
  // 注: /admin/live と /admin/privacy-acceptances は platform admin 専用のため
  //     sidebar には掲載せず、/admin トップで isPlatform 判定して条件表示する
  //     (= 既存 /admin/live と同方針)。
] as const;

// platform admin だけに表示する導線 (= isPlatform が true のときのみ描画)。
// ページ自体の server-side gate / API gate はそのまま維持し、ここは「ナビ表示」のみを制御する。
const PLATFORM_NAV_ITEMS = [
  { href: "/admin/users",                     label: "ユーザー" },
  { href: "/admin/personal-plan-permissions", label: "個人プラン権限" },
  { href: "/admin/business-invite-links",     label: "法人プラン権限" },
] as const;

export function AdminSidebar({ isPlatform = false }: { isPlatform?: boolean }) {
  const pathname = usePathname();

  // 共通項目 + (platform admin のみ) 専用項目
  const navItems = isPlatform ? [...NAV_ITEMS, ...PLATFORM_NAV_ITEMS] : NAV_ITEMS;

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
