// src/lib/template.ts
//
// メッセージ本文の変数差し込み (template interpolation)。
//
// 仕様:
//   - `{key}` 形式 → variables[key] の値で置換
//   - 未保存変数は **空文字** に置換 (ユーザー指示)
//   - 変数名は VARIABLE_KEY_REGEX (^[a-zA-Z_][a-zA-Z0-9_]*$) に一致するパターンのみ対象
//     → 一致しない `{1abc}` `{user name}` 等はテンプレ記法と見なさずそのまま残す
//   - 将来: interpolateWithDiagnostics で未解決キーを列挙できる (CMS バリデーション拡張用)
//
// 自由入力受付モードと併用:
//   webhook で variables に保存された値が、次メッセージ送信時にここで差し込まれる。

/** メッセージ本文 / altText / クイックリプライラベル等に使う `{key}` パターン。
 *  ・先頭は英字 or `_`
 *  ・以降は英数字 + `_`
 *  ・全体を `{}` で囲む
 *  (= Zod の variableKeySchema と同じルール)
 *
 *  既存の `{{user_name}}` (= replacePlaceholders 用、line.ts) との衝突回避のため、
 *  `{` の直前に `{` がある場合 / `}` の直後に `}` がある場合は **置換しない**
 *  (lookbehind / lookahead で除外)。Node 12+ の JS engine で動作する。 */
const INTERPOLATE_REGEX = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

/** 変数を差し込んで本文を返す。未保存変数は空文字に置換。 */
export function interpolate(
  text: string | null | undefined,
  variables: Record<string, string> | null | undefined,
): string {
  if (!text) return "";
  if (!variables) {
    // variables が無いなら全て未保存扱い = 全部空文字に
    return text.replace(INTERPOLATE_REGEX, "");
  }
  return text.replace(INTERPOLATE_REGEX, (_match, key: string) => {
    const v = variables[key];
    return v == null ? "" : String(v);
  });
}

/** 開発者向け: 差し込み結果 + 未解決キー一覧を返す。
 *  CMS 側で「この本文に未保存変数が含まれている」検知に使う想定 (今 PR では UI 化しない、土台のみ)。 */
export function interpolateWithDiagnostics(
  text: string | null | undefined,
  variables: Record<string, string> | null | undefined,
): { text: string; unresolved: string[] } {
  if (!text) return { text: "", unresolved: [] };
  const unresolved: string[] = [];
  const result = text.replace(INTERPOLATE_REGEX, (_match, key: string) => {
    const v = variables?.[key];
    if (v == null) {
      if (!unresolved.includes(key)) unresolved.push(key);
      return "";
    }
    return String(v);
  });
  return { text: result, unresolved };
}

/** 本文に含まれる変数キーを列挙 (重複なし)。
 *  CMS でメッセージを保存する直前に、定義済み変数との整合性チェックなどに使える。 */
export function extractVariableKeys(text: string | null | undefined): string[] {
  if (!text) return [];
  const keys: string[] = [];
  for (const match of text.matchAll(INTERPOLATE_REGEX)) {
    const k = match[1];
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}
