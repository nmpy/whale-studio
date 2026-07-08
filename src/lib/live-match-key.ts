// src/lib/live-match-key.ts
//
// 予約番号 / チケットID の照合キー正規化（PR2b）。
// プレイヤーが LINE で入力した値と、CSV 取込済み LiveTeam.reservationNumber / ticketId を
// 表記ゆれを吸収して突き合わせるための正規化。
//
// 正規化ルール（ユーザー確定）:
//   - trim
//   - 全角英数字 → 半角
//   - 大文字小文字を無視（大文字へ寄せる）
//   - ハイフン類・空白の表記ゆれ吸収（除去）
//
// 注意: これは「照合用キー」であり、表示・保存値そのものは元の入力/CSV 値を保持する。

/** 全角英数字（！-～ = U+FF01..U+FF5E）を対応する半角（U+0021..U+007E）へ。全角スペースも半角へ。 */
function toHalfWidth(input: string): string {
  return input
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/**
 * 予約番号 / チケットID を照合用キーに正規化する。
 * 空・null・undefined、または正規化後が空文字なら null（= 照合対象にしない）。
 */
export function normalizeMatchKey(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = toHalfWidth(String(input)).trim();
  if (s === "") return null;
  // 大文字小文字無視
  s = s.toUpperCase();
  // ハイフン類（-, ‐, ‑, ‒, –, —, ―, − 全角ハイフンマイナス）・空白・アンダースコアを除去
  s = s.replace(/[\s\-‐-―−_]/g, "");
  return s === "" ? null : s;
}

/** 2 つの値が照合キーとして一致するか（両方とも正規化して比較。どちらか null 化なら false）。 */
export function matchKeysEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeMatchKey(a);
  const nb = normalizeMatchKey(b);
  return na !== null && nb !== null && na === nb;
}
