// src/lib/oa-dashboard.ts
//
// アカウント一覧の 0 / 1 / 複数件 分岐の純粋ロジック。
//   - 0 件   : 既存の空状態（新規作成 / 審査中）を表示（変更しない）。
//   - 1 件   : 専用ダッシュボード（SingleOaDashboard）を表示。
//   - 2 件+ : 既存のアカウント一覧を表示（選択導線を変更しない）。
// UI から切り出してテスト可能にするための単一責務の判定関数。

/** アクセス可能アカウントがちょうど 1 件か（＝専用ダッシュボードを表示するか）。 */
export function isSingleAccountView(itemsLen: number, total?: number | null): boolean {
  const t = total ?? itemsLen;
  return itemsLen === 1 && t === 1;
}
