// src/lib/liff/player-settings.ts
//
// プレイヤー向け公開 API が settings_json を返すときの「渡してはいけない設定」除去。
//
// LIFF ページ設定 API (`GET /api/liff/works/[workId]/pages/[pageId]`) は settings_json を
// ほぼそのまま返す設計のため、ネタバレになる設定をここで 1 か所にまとめて落とす。
// 純関数なのでテストから直接呼べる（route.ts からの export は Next の型検査に引っかかるため避ける）。

/** プレイヤーへ配ってはいけない settings_json のキー。 */
export const PLAYER_REDACTED_SETTINGS_KEYS = [
  // 検索型ヒントの本文・キーワード・答え。検索する前に渡すと全ヒントが漏れる。
  "hint_search_entries",
  // 「キーワードがわからない場合」の質問ツリー。選んでいない枝の中身が漏れる。
  "hint_search_guide_options",
] as const;

/**
 * settings_json から PLAYER_REDACTED_SETTINGS_KEYS を除いたコピーを返す。
 *
 * オブジェクト以外（null / 配列 / 文字列など想定外の値）はそのまま返す
 * （settings_json は任意 JSON なので、壊れたデータでも 500 にしない）。
 */
export function redactPlayerSettings(settingsJson: unknown): unknown {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return settingsJson;
  }
  const out: Record<string, unknown> = { ...(settingsJson as Record<string, unknown>) };
  for (const key of PLAYER_REDACTED_SETTINGS_KEYS) delete out[key];
  return out;
}
