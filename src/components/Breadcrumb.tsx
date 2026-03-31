// src/components/Breadcrumb.tsx
// パンくずナビゲーション共通コンポーネント
// 使い方:
//   <Breadcrumb items={[
//     { label: "OA一覧", href: "/oas" },
//     { label: "作品一覧", href: `/oas/${oaId}/works` },
//     { label: "メッセージ管理" },   // href なし → 現在ページ（リンクなし）
//   ]} />

import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="パンくずリスト">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && (
              <span style={{ color: "#d1d5db", userSelect: "none" }}>/</span>
            )}
            {isLast || !item.href ? (
              <span
                style={
                  isLast
                    ? { color: "#374151", fontWeight: 500 }
                    : { color: "#6b7280" }
                }
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </span>
            ) : (
              <Link href={item.href}>{item.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
