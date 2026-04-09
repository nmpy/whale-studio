"use client";

// _node-graph/ui/ErrorToast.tsx — エラートースト通知

import { useCallback, useState } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  type: "error" | "success";
}

let nextId = 0;

export function useGraphToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((text: string, type: "error" | "success" = "error") => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, type === "error" ? 5000 : 3000);
  }, []);

  const showError = useCallback((text: string) => showToast(text, "error"), [showToast]);
  const showSuccess = useCallback((text: string) => showToast(text, "success"), [showToast]);

  return { toasts, showError, showSuccess };
}

export function GraphToastContainer({ toasts }: { toasts: ToastMessage[] }) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        zIndex: 80,
        pointerEvents: "none",
      }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          role="alert"
          style={{
            pointerEvents: "auto",
            background: toast.type === "error" ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`,
            color: toast.type === "error" ? "#991b1b" : "#166534",
            fontSize: 12,
            fontWeight: 600,
            padding: "8px 16px",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            whiteSpace: "nowrap",
            animation: "toast-in 0.2s ease-out",
          }}
        >
          {toast.type === "error" ? "⚠ " : "✓ "}{toast.text}
        </div>
      ))}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
