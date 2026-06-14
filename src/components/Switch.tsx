"use client";

// src/components/Switch.tsx
// 小さな共通トグルスイッチ（ON/OFF が視覚的に分かる）。
// 既存の boolean 値・onChange をそのまま使い、見た目だけ checkbox → switch に置き換える用途。
// アクセシビリティ: role="switch" + aria-checked、button なので Space/Enter で操作可（キーボード対応）。

export function Switch({
  checked, onChange, disabled, id, ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      id={id}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      style={{
        position: "relative", flexShrink: 0,
        width: 40, height: 24, padding: 0, border: "none", borderRadius: 999,
        background: checked ? "#06C755" : "#cbd5e1",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .15s ease", opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 20, height: 20, borderRadius: "50%", background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.25)", transition: "left .15s ease",
        }}
      />
    </button>
  );
}
