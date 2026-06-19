// src/components/liff/ui/tokens.ts
//
// LIFF 新UI（プレイヤー側）デザインシステムの token / class 断片。JSX を含まない純 .ts。
//
// 方針:
//   - 新デザインシステム仕様を「正」とする（PR #381 の暫定値はここで上書き）。
//   - Brand Primary は既存 `--liff-line-green`(#06C755) を参照（値一致）。pressed/tint は新仕様の
//     リテラル値をここに閉じる（global `--liff-*` は変更しない＝ライブ画面に影響させない）。
//   - CMS 側の Tailwind brand class（bg-brand / buttonClass / focus:ring-brand）や InlineWhaleLoader は使わない。
//   - 通常アクションは「箱型ボタン radius12（Filled=primary / Outline=secondary）」。
//     pill / capsule は「カテゴリ選択・トグル・選択状態表示」専用（LiffCapsuleToggle）。
//   - フォントは新 stack（LINE Seed JP を含めない）。letter-spacing は LIFF 画面に適用しない。
//
// このファイルは純関数（cx / actionButtonClass）のみテスト可能。各 .tsx 部品はここを参照する。

/** className 合成（falsy を除外して space 区切り）。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── ブランド色（新仕様） ─────────────────────────────────────────
export const LIFF_BRAND = "#06C755";          // Primary（= --liff-line-green）
export const LIFF_GREEN_PRESSED = "#06A047";  // Pressed
export const LIFF_TINT = "#E8F9EE";           // Brand Tint（淡い緑面・バッジ背景等）

// ── radius（新仕様） ───────────────────────────────────────────
export const LIFF_RADIUS = {
  badge:   "2px",   // 矩形タグバッジ（謎/カテゴリ等）。Q バッジ（円）は別意匠。
  card:    "10px",
  capsule: "16px",  // カプセルトグル（〜42px 高でカプセル見え）。トグル専用。
  button:  "12px",  // 通常アクションボタン（箱型）。
} as const;

// ── card / surface（新仕様: radius10 + 影 0 1px 3px rgba(0,0,0,.05)） ──
export const LIFF_CARD_CLASS =
  "bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border,#eef2f5)] " +
  "rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)]";

/** 緑の淡い tint 背景（Q バッジ等）。新仕様 Brand Tint #E8F9EE。 */
export const LIFF_TINT_BG = "bg-[color:#E8F9EE]";

// ── typography（新仕様） ───────────────────────────────────────
//   page title 20/500・header 15/700・body 14/400/1.85・caption 12.5/400。
//   letter-spacing は付けない（LIFF 不適用）。
export const LIFF_TEXT = {
  pageTitle:   "text-[20px] font-medium leading-tight text-[color:var(--liff-primary-text)] break-words",
  headerTitle: "text-[15px] font-bold leading-snug text-[color:var(--liff-primary-text)] break-words",
  body:        "text-[14px] font-normal leading-[1.85] text-[color:var(--liff-primary-text)]",
  /** 補助テキスト（説明文 / サブテキスト）。本文と同 14px・行間でセカンダリ色。 */
  secondary:   "text-[14px] font-normal leading-[1.85] text-[color:var(--liff-secondary-text)]",
  caption:     "text-[12.5px] font-normal leading-[1.5] text-[color:var(--liff-tertiary-text,#8C8C8C)]",
} as const;

// ── font stack（新仕様・LINE Seed JP を含めない・letter-spacing なし） ──
//   token として定義するのみ。global `.liff-font` には適用しない（画面適用は後続 PR）。
export const LIFF_UI_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
/** 上記 stack を style 適用する用の object（letter-spacing は意図的に含めない）。 */
export const LIFF_UI_FONT_STYLE: { fontFamily: string } = { fontFamily: LIFF_UI_FONT_STACK };

// ── 通常アクションボタン（箱型 radius12・Filled / Outline・disabled） ──
export type LiffActionVariant = "filled" | "outline";

const ACTION_BASE =
  "inline-flex items-center justify-center text-center font-bold rounded-[12px] " +
  "min-h-[48px] px-5 text-[15px] transition-colors transition-opacity " +
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1";

const ACTION_VARIANT: Record<LiffActionVariant, string> = {
  // Filled = primary。塗り #06C755 / 押下 #06A047。
  filled:
    "text-white bg-[color:var(--liff-line-green,#06C755)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:#06A047] active:border-[color:#06A047]",
  // Outline = secondary。緑枠 + 白背景。
  outline:
    "text-[color:var(--liff-line-green,#06C755)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:#E8F9EE]",
};

/** 通常アクションボタン（箱型）の class を組み立てる（純関数・テスト可）。 */
export function actionButtonClass(
  variant: LiffActionVariant = "filled",
  opts?: { fullWidth?: boolean; className?: string },
): string {
  const fullWidth = opts?.fullWidth !== false; // 既定 true
  return cx(ACTION_BASE, ACTION_VARIANT[variant], fullWidth && "w-full", opts?.className);
}

// ── 下線型 input / textarea（新UI・body 14/1.85 トーン） ────────
export const LIFF_UNDERLINE_INPUT =
  "w-full bg-transparent text-[14px] leading-[1.85] py-2 " +
  "text-[color:var(--liff-primary-text,#111)] placeholder:text-[color:var(--liff-tertiary-text,#999)] " +
  "border-0 border-b border-[color:var(--liff-border,#eef2f5)] rounded-none " +
  "focus:outline-none focus:border-[color:var(--liff-line-green,#06C755)] " +
  "disabled:opacity-70 disabled:cursor-not-allowed";

export const LIFF_UNDERLINE_INPUT_ERROR =
  "border-[color:var(--liff-danger,#E22B2B)] focus:border-[color:var(--liff-danger,#E22B2B)]";
