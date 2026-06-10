// src/components/liff/experience/LiffIconBadge.tsx
//
// 体験者向け LIFF 画面で使う円形アイコンバッジ。
// variant ごとに淡い色のリング付きの円を描き、中央にアイコン（絵文字 or ノード）を置く。
// success は控えめなチェック SVG をデフォルト表示する。

import type { ReactNode } from "react";

export type LiffStateVariant =
  | "loading"
  | "success"
  | "info"
  | "warning"
  | "error"
  | "permission";

const TINT: Record<Exclude<LiffStateVariant, "loading">, { bg: string; ring: string; fg: string }> = {
  success:    { bg: "#e7f7ee", ring: "#bfe9d2", fg: "#0f9d58" },
  info:       { bg: "#e8f1fd", ring: "#cadcfb", fg: "#2563eb" },
  warning:    { bg: "#fdf3e2", ring: "#f6e1b6", fg: "#b45309" },
  error:      { bg: "#fdecec", ring: "#f6cecb", fg: "#d6443c" },
  permission: { bg: "#fdf3e2", ring: "#f6e1b6", fg: "#b45309" },
};

export function LiffIconBadge({
  variant,
  icon,
  size = 64,
}: {
  variant: Exclude<LiffStateVariant, "loading">;
  /** 絵文字文字列や任意ノード。未指定なら variant ごとの既定アイコン。 */
  icon?: ReactNode;
  size?: number;
}) {
  const tint = TINT[variant];
  const content =
    icon !== undefined && icon !== null && icon !== "" ? (
      <span style={{ fontSize: Math.round(size * 0.42), lineHeight: 1 }}>{icon}</span>
    ) : variant === "success" ? (
      <svg width={Math.round(size * 0.46)} height={Math.round(size * 0.46)} viewBox="0 0 24 24"
        fill="none" stroke={tint.fg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    ) : (
      <span style={{ fontSize: Math.round(size * 0.42), fontWeight: 800, color: tint.fg, lineHeight: 1 }}>!</span>
    );

  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: tint.bg,
        boxShadow: `0 0 0 6px ${tint.ring}33, inset 0 0 0 1px ${tint.ring}`,
        color: tint.fg,
      }}
    >
      {content}
    </span>
  );
}
