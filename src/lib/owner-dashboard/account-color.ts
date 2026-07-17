// src/lib/owner-dashboard/account-color.ts
// アカウント識別色（決定論的・データ非依存）。同一 oaId は常に同じ色。
// 既存のアカウント色トークンは無いため、固定パレットから id ハッシュで安定的に割り当てる。
// 純関数（テスト可能・server/client 双方から使用可）。

export interface AccountColor { dot: string; bg: string; text: string }

// ハンドオフのアカウント識別色を基調にした固定パレット。
const ACCOUNT_PALETTE: AccountColor[] = [
  { dot: "#2b7f9b", bg: "#e4f1f5", text: "#2b7f9b" },
  { dot: "#b06a2c", bg: "#f6ede2", text: "#b06a2c" },
  { dot: "#c04f80", bg: "#f7e3ec", text: "#c04f80" },
  { dot: "#178a48", bg: "#e6f6ec", text: "#178a48" },
  { dot: "#7a4fd0", bg: "#efeafa", text: "#7a4fd0" },
  { dot: "#3b6fd4", bg: "#e7effd", text: "#3b6fd4" },
];

export function accountColor(oaId: string): AccountColor {
  let h = 0;
  for (let i = 0; i < oaId.length; i++) h = (h * 31 + oaId.charCodeAt(i)) >>> 0;
  return ACCOUNT_PALETTE[h % ACCOUNT_PALETTE.length];
}
