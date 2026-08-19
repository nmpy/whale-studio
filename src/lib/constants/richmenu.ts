// src/lib/constants/richmenu.ts
//
// リッチメニュー画像の LINE 側制約。**client / server の両方から import する**ため、
// Prisma などサーバー専用の依存を持たない独立モジュールにしてある
// （client component から @/lib/line-richmenu を import すると node:async_hooks が
//   バンドルに混入してビルドが落ちる）。
//
// CMS の汎用画像アップロード上限（/api/upload = 5 MB）とは別物。
// 混同すると「CMS では保存できるのに適用で必ず失敗する」状態になる
// （2026-08-19 の本番障害: 3.09 MB の画像で content upload が 413 →
//  そのまま default 化しようとして 400 "must upload richmenu image before applying it to user"）。

/** LINE のリッチメニュー画像サイズ上限（1 MB）。 */
export const RICH_MENU_IMAGE_MAX_BYTES = 1024 * 1024;

/** リッチメニュー画像として LINE が受け付ける MIME。 */
export const RICH_MENU_IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export type RichMenuImageMimeType = (typeof RICH_MENU_IMAGE_MIME_TYPES)[number];

/** 運用者に見せる上限の表示（UI 文言とエラーメッセージで同じ値を使う）。 */
export const RICH_MENU_IMAGE_MAX_LABEL = "1MB";

/** バイト数を MB 表記へ（エラーメッセージ用）。 */
export function formatBytesAsMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}
