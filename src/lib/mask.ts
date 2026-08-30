// src/lib/mask.ts
// 個人情報・識別子のマスク表示ユーティリティ（画面表示・監査ログで共通利用）。

/**
 * LINE User ID をマスクする。完全な値は表示・保存しない。
 * 例: "U1234abcd....wxyz" → "U1234••••••••wxyz"（先頭5 + 固定8ドット + 末尾4）。
 * 長さを固定ドットにして UID の長さも推測させない。
 */
export function maskLineUserId(uid: string | null | undefined): string {
  const s = (uid ?? "").trim();
  if (!s) return "";
  const head = 5;
  const tail = 4;
  if (s.length <= head + tail) {
    // 極端に短い場合は先頭1文字のみ残す。
    return s.slice(0, 1) + "•".repeat(8);
  }
  return s.slice(0, head) + "•".repeat(8) + s.slice(s.length - tail);
}
