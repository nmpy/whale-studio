// src/components/Breadcrumb.tsx
// パンくずナビゲーション共通コンポーネント
// 使い方:
//   <Breadcrumb items={[
//     { label: "アカウントリスト", href: "/oas" },
//     { label: "作品リスト", href: `/oas/${oaId}/works` },
//     { label: "メッセージ管理" },   // href なし → 現在ページ（リンクなし）
//   ]} />
// ※ 先頭に「TOP」(href="/") が自動で追加されます

import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const allItems: BreadcrumbItem[] = [{ label: "TOP", href: "/" }, ...items];

  return (
    <nav className="breadcrumb" aria-label="パンくずリスト">
      {allItems.map((item, i) => {
        const isLast = i === allItems.length - 1;
        return (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && (
              <span style={{ color: "#9ca3af", userSelect: "none" }}>＞</span>
            )}
            {isLast || !item.href ? (
              <span
                style={
                  isLast
                    ? { color: "#111827", fontWeight: 700 }
                    : { color: "#6b7280" }
                }
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </span>
            ) : (
              <Link href={item.href} style={{ color: "#4b5563" }}>{item.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
