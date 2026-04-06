"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// ────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────
type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

// ────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ────────────────────────────────────────────────
// 個別トーストアイテム
// ────────────────────────────────────────────────
function ToastItem({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // マウント直後にアニメーション開始
    const show = requestAnimationFrame(() => setVisible(true));
    // 2.6 秒後にフェードアウト開始 → 0.4 秒後に削除
    const fade = setTimeout(() => setVisible(false), 2600);
    const remove = setTimeout(() => onRemove(item.id), 3000);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, [item.id, onRemove]);

  const icons: Record<ToastType, string> = {
    success: "",
    error: "✕",
    info: "ℹ",
  };

  return (
    <div
      className={`toast toast-${item.type}`}
      style={{ opacity: visible ? 1 : 0, transform: visible ? "translateX(0)" : "translateX(24px)" }}
      role="alert"
      aria-live="polite"
    >
      {icons[item.type] && <span className="toast-icon">{icons[item.type]}</span>}
      <span>{item.message}</span>
      <button
        className="toast-close"
        onClick={() => onRemove(item.id)}
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++counter.current;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]); // 最大5件
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div key={t.id} style={{ pointerEvents: "auto" }}>
            <ToastItem item={t} onRemove={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
