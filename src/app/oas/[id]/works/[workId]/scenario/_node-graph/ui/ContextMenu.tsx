"use client";

// _node-graph/ui/ContextMenu.tsx — 右クリックコンテキストメニュー

import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 画面端の補正 + 外部クリック/Esc で閉じる
  useEffect(() => {
    const el = menuRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (rect.right > vw) el.style.left = `${x - rect.width}px`;
      if (rect.bottom > vh) el.style.top = `${y - rect.height}px`;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 次のティックで登録（右クリック自体で閉じないように）
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKey);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [x, y, onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="コンテキストメニュー"
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 100,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        padding: "4px 0",
        minWidth: 160,
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 500,
            color: item.disabled ? "#d1d5db" : item.danger ? "#dc2626" : "#374151",
            background: "none",
            border: "none",
            cursor: item.disabled ? "not-allowed" : "pointer",
            textAlign: "left",
          }}
          onMouseEnter={e => {
            if (!item.disabled) (e.currentTarget as HTMLElement).style.background = "#f3f4f6";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "none";
          }}
        >
          {item.icon && <span aria-hidden="true" style={{ fontSize: 14, width: 18, textAlign: "center" }}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}
