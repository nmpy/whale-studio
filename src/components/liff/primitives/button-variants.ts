// src/components/liff/primitives/button-variants.ts
//
// LIFF ボタン variant の「唯一の真実源」。JSX を含まない純 .ts なので、
// renderer / block 設定フォーム / Zod validation / テストのどこからでも
// （クライアント component を引き込まずに）import できる。
// LiffButton.tsx はここから import して再 export する。

/** ボタンデザインの許可値（単一源）。新 preset はここと VARIANT_CLASSES に1行ずつ追加する。 */
export const LIFF_BUTTON_VARIANTS = ["primary", "outline", "ghost", "dark", "danger"] as const;
export type LiffButtonVariant = (typeof LIFF_BUTTON_VARIANTS)[number];

/** variant 未指定 / 未知値のときに使う既定。 */
export const DEFAULT_LIFF_BUTTON_VARIANT: LiffButtonVariant = "primary";

/**
 * 任意の入力値を既知の LiffButtonVariant に正規化する。
 * 既知の variant ならそのまま、未知・未指定・型外の値なら fallback (既定 primary) を返す。
 * settingsJson 等の外部由来値を描画前に通すことで、見た目が壊れず安全側に倒れる。
 */
export function normalizeLiffButtonVariant(
  value: unknown,
  fallback: LiffButtonVariant = DEFAULT_LIFF_BUTTON_VARIANT,
): LiffButtonVariant {
  return (LIFF_BUTTON_VARIANTS as readonly string[]).includes(value as string)
    ? (value as LiffButtonVariant)
    : fallback;
}
