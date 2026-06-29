// src/lib/announcement-display.ts
//
// /oas（アカウントリスト）のお知らせ最大表示件数の normalize（純ロジック・no JSX → node テスト可）。
//
// 保存先は StudioSetting.announcementDisplayLimit（singleton・nullable）。
// 未設定(null/undefined)・不正値はすべて既定 3 に、範囲外は 1〜10 に clamp する。
// API（GET /api/announcement-settings, PATCH /api/admin/announcement-settings）と
// UI（/admin/announcements の保存）で同じ規則を使うため、ここに集約する。

export const DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT = 3;
export const MIN_ANNOUNCEMENT_DISPLAY_LIMIT = 1;
export const MAX_ANNOUNCEMENT_DISPLAY_LIMIT = 10;

/**
 * 表示件数を正規化する。
 *   - null / undefined / NaN / 文字列など不正値 / 0 / 負数 / 小数 → 既定 3
 *   - 1〜10 の整数 → そのまま
 *   - 11 以上 → 10（上限 clamp）
 * 仕様: 「未設定や不正は安全側で 3、範囲外は 1〜10 に丸める」。
 */
export function normalizeAnnouncementLimit(value: unknown): number {
  // number 以外（文字列・null・undefined・object 等）は既定へ。
  // ただし数値文字列も受けたいので、number か finite な数値文字列のみ数値化する。
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    n = Number(value);
  } else {
    return DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT;
  }

  if (!Number.isFinite(n)) return DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT; // NaN / Infinity
  if (!Number.isInteger(n)) return DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT; // 小数は不正扱い→既定
  if (n < MIN_ANNOUNCEMENT_DISPLAY_LIMIT) return DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT; // 0・負数→既定
  if (n > MAX_ANNOUNCEMENT_DISPLAY_LIMIT) return MAX_ANNOUNCEMENT_DISPLAY_LIMIT; // 上限 clamp
  return n;
}
