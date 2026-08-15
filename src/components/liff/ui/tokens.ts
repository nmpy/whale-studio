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
//   token bridge: 実 class では値を `var(--liff-ui-*, fallback)` 経由で参照し、正準値は
//   liff-font.css の `--liff-ui-*` に置く（fallback は現行値と一致＝未定義でも見た目不変）。
//   下記の JS 定数（LIFF_BRAND 等）は inline style / テスト参照用にリテラル値を維持する。
export const LIFF_BRAND = "#06C755";          // Primary（= --liff-line-green）
export const LIFF_GREEN_PRESSED = "#06A047";  // Pressed（= --liff-ui-green-pressed）
export const LIFF_TINT = "#E8F9EE";           // Brand Tint（= --liff-ui-green-soft）

// ── radius（新仕様） ───────────────────────────────────────────
export const LIFF_RADIUS = {
  badge:   "2px",   // 矩形タグバッジ（謎/カテゴリ等）。Q バッジ（円）は別意匠。
  card:    "10px",  // = --liff-ui-card-radius
  capsule: "16px",  // カプセルトグル（〜42px 高でカプセル見え）。トグル専用。
  button:  "12px",  // 通常アクションボタン（箱型）。
} as const;

// ── card / surface（新仕様: radius10 + 影 0 1px 3px rgba(0,0,0,.05)） ──
//   radius/shadow は Tailwind arbitrary value の堅牢性のためリテラル維持（正準値は
//   --liff-ui-card-radius / --liff-ui-card-shadow に併記）。border のみ ui token を参照。
export const LIFF_CARD_CLASS =
  "bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-ui-card-border,#eef2f5)] " +
  "rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)]";

/** 緑の淡い tint 背景（Q バッジ等）。新仕様 Brand Tint = --liff-ui-green-soft(#E8F9EE)。 */
export const LIFF_TINT_BG = "bg-[color:var(--liff-ui-green-soft,#E8F9EE)]";

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
//   danger / dangerOutline は「取り消せない開示（答えを見る 等）」専用。
//   通常の CTA には使わない（赤の意味を薄めないため）。
export type LiffActionVariant = "filled" | "outline" | "neutral" | "danger" | "dangerOutline";

const ACTION_BASE =
  "inline-flex items-center justify-center text-center font-bold rounded-[12px] " +
  "min-h-[48px] px-5 text-[15px] transition-colors transition-opacity " +
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--liff-line-green,#06C755)] focus-visible:ring-offset-1";

const ACTION_VARIANT: Record<LiffActionVariant, string> = {
  // Filled = primary。塗り #06C755 / 押下 = --liff-ui-green-pressed(#06A047)。
  // 文字色は --liff-on-accent（既定 #fff = 従来の text-white と同値）。
  // color_mode で塗りの明度が変わったときに、文字色だけ差し替えられるようにしている。
  filled:
    "text-[color:var(--liff-on-accent,#fff)] bg-[color:var(--liff-line-green,#06C755)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:var(--liff-ui-green-pressed,#06A047)] active:border-[color:var(--liff-ui-green-pressed,#06A047)]",
  // Outline = secondary。緑枠 + 白背景。押下面 = --liff-ui-green-soft(#E8F9EE)。
  // 文字は --liff-accent-text（既定は --liff-line-green と同値 = 従来と同じ見た目）。
  // 暗色モードでは「面の色」と「文字の色」で必要な明度が逆になるため、この 2 つを分けている。
  outline:
    "text-[color:var(--liff-accent-text,#06C755)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-line-green,#06C755)] " +
    "active:bg-[color:var(--liff-ui-green-soft,#E8F9EE)]",
  // Neutral = カード内の副次アクション（次の段階を開く 等）。ブランド色を使わない控えめな箱型。
  neutral:
    "text-[color:var(--liff-primary-text,#1F2329)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-border,#eef2f5)] " +
    "active:bg-[color:var(--liff-surface-subtle,#FAFAFA)]",
  // Danger = 取り消せない開示の実行ボタン。文字色は filled と同じ --liff-on-accent。
  // 面は --liff-danger-surface（既定は --liff-danger と同値＝従来の見た目のまま）。
  // 暗色テーマでは「文字用の明るい赤」と「白文字が乗る濃い赤」を分ける必要があるため、
  // 面だけ別トークンを参照する。文字・枠線として使う側は従来どおり --liff-danger。
  danger:
    "text-[color:var(--liff-on-accent,#fff)] bg-[color:var(--liff-danger-surface,#E22B2B)] border border-[color:var(--liff-danger-surface,#E22B2B)] " +
    "active:bg-[color:var(--liff-danger-surface-press,#C42323)] active:border-[color:var(--liff-danger-surface-press,#C42323)]",
  // Danger Outline = その手前の「確認へ進む」ボタン。赤枠 + 赤文字 + 白背景。
  dangerOutline:
    "text-[color:var(--liff-danger,#E22B2B)] bg-[color:var(--liff-surface,#fff)] border border-[color:var(--liff-danger,#E22B2B)] " +
    "active:bg-[color:rgba(226,43,43,0.06)]",
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
