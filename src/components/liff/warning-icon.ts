// src/components/liff/warning-icon.ts
// PR-BLK4a: バナー（warning ブロック）の左アイコン解決（純関数・no JSX → node テスト可）。
//
// settings.icon と tone から「実際に描画するアイコン種別」を返す。
//   - icon 未設定 / "auto" / 不明値 → tone から自動導出
//   - "none" → アイコン非表示
//   - "warning" | "info" | "alert" → そのまま明示指定
// 既存データ互換: icon が無い既存 warning は "auto" 扱いになる。

/** 実際に描画するアイコン種別（"none" は非表示）。 */
export type WarningIconKind = "warning" | "info" | "alert" | "none";

/** tone から自動でアイコンを導出（unknown tone は warning にフォールバック）。 */
function iconFromTone(tone: string | undefined): Exclude<WarningIconKind, "none"> {
  switch (tone) {
    case "info":    return "info";
    case "danger":  return "alert";
    case "spoiler": return "warning";
    default:        return "warning";
  }
}

export function resolveWarningIcon(
  tone: string | undefined,
  icon: string | undefined,
): WarningIconKind {
  if (icon === "none") return "none";
  if (icon === "warning" || icon === "info" || icon === "alert") return icon;
  // undefined / "auto" / 不明値 → tone から自動（安全側）。
  return iconFromTone(tone);
}
