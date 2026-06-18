// src/components/liff/ui/tokens.ts
//
// LIFF 新UI（プレイヤー側）デザインシステムの token / class 断片。JSX を含まない純 .ts。
//
// 方針:
//   - 既存の `--liff-*` CSS variables を「正」として尊重し、ここでは Tailwind の class 断片に束ねるだけ。
//   - CMS 側の Tailwind brand class（bg-brand / buttonClass / focus:ring-brand）や InlineWhaleLoader は使わない。
//   - LINE らしい green #06C755 を primary、ダーク #111（--liff-primary-text）を secondary 強調に。
//   - カードは radius 18px、ボタンは新UIに合わせて「ピル型」を基本にする。
//   - input / textarea は新UIの「下線型」を別途用意する（既存 primitive の箱型は壊さない）。
//
// このファイルは純関数のみ（cx / actionButtonClass）でテスト可能。各 .tsx 部品はここを参照する。

/** className 合成（falsy を除外して space 区切り）。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── radius / shadow / surface ───────────────────────────────────
export const LIFF_RADIUS = {
  /** カード（標準）。renderer 群の rounded-[18px] と一致。 */
  card: "18px",
  /** 大きめカード（ホームのヒーロー等）。 */
  cardLg: "20px",
  /** ピルボタン / バッジ。 */
  pill: "999px",
} as const;

/** カード面の標準 class（白サーフェス + 薄い境界 + radius18 + 控えめな影）。 */
export const LIFF_CARD_CLASS =
  "bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border,#eef2f5)] " +
  "rounded-[18px] shadow-[0_2px_10px_rgba(31,64,92,0.05)]";

/** 緑の淡い tint（Q バッジ等の背景）。--liff-* に soft green が無いため tint をここで一元化。 */
export const LIFF_GREEN_SOFT = "bg-[color:rgba(6,199,85,0.12)]";

// ── テキスト ───────────────────────────────────────────────────
export const LIFF_TEXT = {
  pageTitle:  "text-[22px] font-bold leading-tight text-[color:var(--liff-primary-text)] break-words",
  sectionTitle: "text-[16px] font-bold leading-snug text-[color:var(--liff-primary-text)] break-words",
  body:       "text-[15px] leading-[1.6] text-[color:var(--liff-primary-text)]",
  secondary:  "text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)]",
  caption:    "text-[12px] leading-[1.5] text-[color:var(--liff-tertiary-text,#8C8C8C)]",
} as const;

// ── ピルボタン（新UI） ─────────────────────────────────────────
export type LiffActionVariant = "primary" | "dark" | "outline" | "ghost";

const ACTION_BASE =
  "inline-flex items-center justify-center font-bold tracking-tight rounded-full " +
  "min-h-[52px] px-6 text-[15px] transition-colors transition-opacity " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1";

const ACTION_VARIANT: Record<LiffActionVariant, string> = {
  primary:
    "text-white bg-[color:var(--liff-line-green,#06C755)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:var(--liff-line-green-press,#05B14C)] active:border-[color:var(--liff-line-green-press,#05B14C)]",
  dark:
    "text-white bg-[color:var(--liff-primary-text,#111)] border border-[color:var(--liff-primary-text,#111)] active:opacity-90",
  outline:
    "text-[color:var(--liff-line-green,#06C755)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:rgba(6,199,85,0.06)]",
  ghost:
    "text-[color:var(--liff-line-green,#06C755)] bg-transparent border border-transparent active:bg-[color:rgba(6,199,85,0.08)]",
};

/** 新UI ピルボタンの class を組み立てる（純関数・テスト可）。 */
export function actionButtonClass(
  variant: LiffActionVariant = "primary",
  opts?: { fullWidth?: boolean; className?: string },
): string {
  const fullWidth = opts?.fullWidth !== false; // 既定 true
  return cx(ACTION_BASE, ACTION_VARIANT[variant], fullWidth && "w-full", opts?.className);
}

// ── 下線型 input / textarea（新UI） ────────────────────────────
/** 下線スタイルの入力共通 class。箱型の primitives/LiffField とは別系統。 */
export const LIFF_UNDERLINE_INPUT =
  "w-full bg-transparent text-[15px] leading-[1.6] py-2 " +
  "text-[color:var(--liff-primary-text,#111)] placeholder:text-[color:var(--liff-tertiary-text,#999)] " +
  "border-0 border-b border-[color:var(--liff-border,#eef2f5)] rounded-none " +
  "focus:outline-none focus:border-[color:var(--liff-line-green,#06C755)] " +
  "disabled:opacity-70 disabled:cursor-not-allowed";

export const LIFF_UNDERLINE_INPUT_ERROR =
  "border-[color:var(--liff-danger,#E22B2B)] focus:border-[color:var(--liff-danger,#E22B2B)]";
