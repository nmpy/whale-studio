// src/lib/format-datetime.ts
//
// 一覧カードの作成日時 / 更新日時など「日付だけでは粒度が足りない」箇所で使う
// 日時フォーマッタ。日本時間 (Asia/Tokyo)・24時間表記・秒なしで「YYYY/MM/DD HH:mm」を返す。

/**
 * ISO 文字列 / Date を「YYYY/MM/DD HH:mm」(Asia/Tokyo・秒なし・24時間) で整形する。
 *
 * - null / undefined / 空文字 / 不正な日付は "-" を返す（既存UIのフォールバックに合わせる）。
 * - タイムゾーンは Asia/Tokyo に固定（サーバー runtime が UTC でも日本時間で表示する）。
 * - 出力は formatToParts で組み立て、環境差で区切りが変わらないよう保証する。
 *
 * 例: formatDateTime("2026-06-15T05:32:00Z") => "2026/06/15 14:32"
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year:   "numeric",
    month:  "2-digit",
    day:    "2-digit",
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  // 一部環境では深夜0時が "24" として返るため "00" に正規化する。
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("year")}/${get("month")}/${get("day")} ${hour}:${get("minute")}`;
}
