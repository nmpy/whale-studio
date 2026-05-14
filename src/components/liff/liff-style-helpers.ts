// src/components/liff/liff-style-helpers.ts
//
// LIFF プレイヤー / プレビュー共通のスタイル計算ヘルパー。
// 個別の renderer から直接参照されるため、副作用は一切持たないこと。

import type {
  LiffFontFamily,
  LiffFontWeight,
  LiffHeadingLevel,
  LiffPageConfigSettings,
  HeadingSettings,
  TextSettings,
} from "@/types";

/** ルート div の className に足す追加クラス文字列。
 *  ゴシックは何も足さず (CSS の既定で .liff-font が当たる)、明朝のとき --mincho を付ける。 */
export function fontFamilyClass(family: LiffFontFamily | undefined): string {
  return family === "mincho" ? "liff-font--mincho" : "";
}

/** page settings から root クラス文字列を組み立てる。
 *  既存の className と組み合わせて使う想定: `${ROOT_BASE} ${liffRootClass(settings)}` */
export function liffRootClass(settings: LiffPageConfigSettings | undefined): string {
  return fontFamilyClass(settings?.font_family);
}

/** Tailwind の font-weight class へのマッピング。
 *  値が不明 / 未指定の場合は default を返す。
 *  - normal → font-normal (400)
 *  - medium → font-semibold (600)  (LINE Design System の medium は 500-600 のため semibold で代用)
 *  - bold   → font-bold (700) */
export function fontWeightClass(
  weight: LiffFontWeight | undefined,
  fallback: LiffFontWeight = "normal",
): string {
  const w = weight ?? fallback;
  if (w === "medium") return "font-semibold";
  if (w === "bold")   return "font-bold";
  return "font-normal";
}

/** Heading レベルに対応する font-size / line-height の Tailwind クラス。
 *  数値で受け取り、不明値は H2 にフォールバック。 */
export function headingSizeClass(level: LiffHeadingLevel | undefined): string {
  switch (level) {
    case 1: return "text-[22px] leading-tight tracking-tight";
    case 2: return "text-[20px] leading-tight tracking-tight";
    case 3: return "text-[18px] leading-snug";
    case 4: return "text-[16px] leading-snug";
    case 5: return "text-[14px] leading-snug";
    default: return "text-[20px] leading-tight tracking-tight";
  }
}

/** HeadingSettings から最終的に適用する font-weight class を出す。
 *  未指定なら "bold" を既定とする (見出しの既定)。 */
export function headingWeightClass(settings: HeadingSettings): string {
  return fontWeightClass(settings.font_weight, "bold");
}

/** TextSettings から最終的に適用する font-weight class を出す。
 *  互換ルール: 旧 emphasis="strong" は font_weight 未指定でも bold 扱いする。 */
export function textWeightClass(settings: TextSettings): string {
  if (settings.font_weight) return fontWeightClass(settings.font_weight, "normal");
  if (settings.emphasis === "strong") return "font-bold";
  return "font-normal";
}
