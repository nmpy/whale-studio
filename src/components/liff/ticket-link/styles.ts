// src/components/liff/ticket-link/styles.ts
//
// LIFF「チケット連携」画面の class 断片。JSX を含まない純 .ts（テスト可能）。
//
// 方針:
//   - 色・角丸・境界線は既存の LIFF デザイントークン（`--liff-*` / `--liff-ui-*`）を参照する。
//     直値は「トークンが無い場合の fallback」としてのみ書く。
//   - 既存の共通 UI（ui/tokens.ts）は変更しない。チケット連携のデザイン要件（箱型入力・
//     50px CTA・確認カード）は他 LIFF 画面（下線入力トーン）と異なるため、この層に閉じる。
//   - タップ領域は原則 44px 以上。フォーカスリングは消さない。

/**
 * 入力欄（箱型・高さ 50px・角丸 8px）。
 *
 * **Tailwind ユーティリティでは当てられない。** globals.css の
 * `input[type="text"], select, textarea { … }` は unlayered なため、
 * Tailwind の `@layer utilities`（border / rounded / px 等）を常に上書きしてしまう。
 * そのため見た目は liff-font.css の `.liff-font .liff-tl-input`（specificity 0,2,0）が持ち、
 * ここではその class 名だけを公開する。globals.css は変更しない（CMS 側に影響させない）。
 */
export const TL_INPUT = "liff-tl-input";

/** 通常時（既定）。現状は追加の class を要さないが、呼び出し側の分岐を対称にするため公開する。 */
export const TL_INPUT_NORMAL = "";

/** エラー時の入力欄（色だけに依存せず、文言も必ず併記すること）。 */
export const TL_INPUT_ERROR = "liff-tl-input--error";

/** select（ネイティブ矢印を消し、自前シェブロン分の余白を確保する）。 */
export const TL_SELECT = "liff-tl-input";

/** 未選択（プレースホルダー相当）の select は補足テキスト色にする。 */
export const TL_SELECT_PLACEHOLDER = "liff-tl-input--placeholder";

/**
 * 編集不可の表示欄（対象公演など）。
 * `disabled` は文字が極端に薄くなり可読性が落ちるため使わず、非フォーム要素として描画する。
 * input ではないので globals.css のフォーム規則に当たらず、Tailwind で足りる。
 */
export const TL_READONLY_FIELD =
  "w-full min-h-[50px] px-3.5 py-3 rounded-[8px] text-[15px] leading-[1.5] break-words " +
  "border border-[color:var(--liff-ui-input-box-border,#DDE3E8)] " +
  "bg-[color:var(--liff-ui-disabled-bg,#F2F4F6)] text-[color:var(--liff-primary-text,#1F2329)]";

/** ラベル。 */
export const TL_LABEL = "block text-[13.5px] font-medium leading-[1.6] text-[color:var(--liff-primary-text,#1F2329)]";

/** 「必須」バッジ（色だけでなく文言でも必須を示す）。 */
export const TL_REQUIRED_BADGE =
  "text-[11.5px] font-bold leading-none text-[color:var(--liff-line-green,#06C755)]";

/** 入力欄直下のエラー文言。 */
export const TL_FIELD_ERROR = "text-[12.5px] leading-[1.6] text-[color:var(--liff-danger,#E22B2B)]";

// ─── ボタン ─────────────────────────────────────────────────────────────────

const CTA_BASE =
  "w-full min-h-[52px] px-4 rounded-[8px] text-[15px] font-bold leading-[1.4] " +
  "inline-flex items-center justify-center text-center transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "focus-visible:ring-[color:var(--liff-line-green,#06C755)]";

/** メイン CTA（グリーン塗り）。 */
export const TL_CTA_PRIMARY =
  CTA_BASE +
  " text-white bg-[color:var(--liff-line-green,#06C755)] border border-[color:var(--liff-line-green,#06C755)] " +
  "active:bg-[color:var(--liff-ui-green-pressed,#06A047)] active:border-[color:var(--liff-ui-green-pressed,#06A047)] " +
  "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:bg-[color:var(--liff-line-green,#06C755)]";

/** 閉じるなどの中立ボタン（白背景 + 薄いボーダー + 黒文字）。 */
export const TL_CTA_NEUTRAL =
  CTA_BASE +
  " text-[color:var(--liff-primary-text,#1F2329)] bg-[color:var(--liff-surface,#fff)] " +
  "border border-[color:var(--liff-ui-input-box-border,#DDE3E8)] " +
  "active:bg-[color:var(--liff-surface-subtle,#FAFAFA)] " +
  "focus-visible:ring-[color:var(--liff-primary-text,#1F2329)]";

/** 未提供機能の無効ボタン（hover / active 表現を出さない）。 */
export const TL_CTA_DISABLED =
  CTA_BASE +
  " cursor-not-allowed bg-[color:var(--liff-ui-disabled-bg,#F2F4F6)] " +
  "text-[color:var(--liff-ui-disabled-text,#B0B4BA)] " +
  "border border-[color:var(--liff-ui-input-box-border,#DDE3E8)]";

/** 「戻る」等のテキストボタン。タップ領域 44px を確保する。 */
export const TL_TEXT_BUTTON =
  "w-full min-h-[44px] inline-flex items-center justify-center text-center " +
  "text-[14px] leading-[1.4] text-[color:var(--liff-secondary-text,#5B6168)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:rounded-[6px] " +
  "focus-visible:ring-[color:var(--liff-line-green,#06C755)] " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

// ─── カード / バッジ ────────────────────────────────────────────────────────

/** 確認カード・完了カードの外枠。 */
export const TL_CARD =
  "rounded-[10px] border border-[color:var(--liff-ui-card-border,#eef2f5)] " +
  "bg-[color:var(--liff-surface,#fff)] overflow-hidden";

/** カード内の 1 行（左 = 項目名 / 右 = 値）。行間に薄い区切り線を入れる。 */
export const TL_CARD_ROW =
  "flex items-start justify-between gap-4 px-4 py-3.5 " +
  "border-t border-[color:var(--liff-ui-card-border,#eef2f5)] first:border-t-0";

export const TL_CARD_ROW_LABEL =
  "shrink-0 text-[13.5px] leading-[1.6] text-[color:var(--liff-secondary-text,#5B6168)]";

/** 値は右寄せ・やや太字。長い値は折り返す（横スクロールを発生させない）。 */
export const TL_CARD_ROW_VALUE =
  "min-w-0 flex-1 text-right text-[14px] font-bold leading-[1.6] " +
  "text-[color:var(--liff-primary-text,#1F2329)] break-words [overflow-wrap:anywhere]";

/** 運営確認待ちなどのステータスバッジ（薄いオレンジ）。 */
export const TL_STATUS_BADGE =
  "inline-flex items-center rounded-[4px] px-2 py-1 text-[12px] font-bold leading-[1.3] " +
  "bg-[color:var(--liff-ui-warning-bg,#FEF9EC)] " +
  "text-[color:var(--liff-ui-warning-text,#B9761A)] " +
  "border border-[color:var(--liff-ui-warning-border,#F0DBB0)]";
