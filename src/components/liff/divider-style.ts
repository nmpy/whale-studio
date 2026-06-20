// src/components/liff/divider-style.ts
// PR-BLK4c: 区切り線（divider ブロック）の表示スタイル解決（純関数・no JSX → node テスト可）。
//
// settings.style / settings.label から「実際に描画するスタイル」を返す。
//   - undefined / 不明値        → "solid"（既存挙動）
//   - "dashed" | "dotted" | "thick" → そのまま
//   - "label" かつ label が非空  → "label"
//   - "label" かつ label が空    → "solid"（ラベルが無いので線だけ＝solid 相当にフォールバック）
// 副作用なし。window/document/prisma/fetch 等に依存しない。

export type DividerStyle = "solid" | "dashed" | "dotted" | "thick" | "label";

export function resolveDividerStyle(
  style: string | undefined,
  label: string | undefined,
): DividerStyle {
  if (style === "dashed" || style === "dotted" || style === "thick") return style;
  if (style === "label") return (label ?? "").trim() !== "" ? "label" : "solid";
  // "solid" / undefined / 不明値 → solid。
  return "solid";
}
