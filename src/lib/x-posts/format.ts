// src/lib/x-posts/format.ts
// X投稿管理のクライアント安全な純関数（UTM 生成 / URL 検証 / ハッシュタグ整形）。
// crypto 等のサーバー専用 API は使わない（tracking-server.ts 側に分離）。

export interface UtmParams {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

/** http/https の有効な URL か。 */
export function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 遷移先 URL に UTM を安全に付与する。
 * - URLSearchParams で生成（既存クエリは保持）。
 * - 既存 UTM パラメータがある場合は上書きする。
 * - 不正 URL は null を返す（呼び出し側でエラー表示）。
 * - 空の UTM 値はセットしない。
 */
export function buildUtmUrl(baseUrl: string, utm: UtmParams): string | null {
  const trimmed = (baseUrl ?? "").trim();
  if (!isValidHttpUrl(trimmed)) return null;
  const url = new URL(trimmed);
  const set = (key: string, v?: string | null) => {
    const t = (v ?? "").trim();
    if (t) url.searchParams.set(key, t); // 既存 UTM は上書き
  };
  set("utm_source", utm.source);
  set("utm_medium", utm.medium);
  set("utm_campaign", utm.campaign);
  set("utm_content", utm.content);
  set("utm_term", utm.term);
  return url.toString();
}

/**
 * ハッシュタグ入力（半角/全角スペース・改行区切り）を正規化した配列にする。
 * - 先頭に # がなければ補完。重複除外。空は除外。
 */
export function parseHashtagsInput(raw: string): string[] {
  const tokens = (raw ?? "")
    .split(/[\s　]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  return Array.from(new Set(tokens));
}

/** 保存済みハッシュタグ（string[]）を本文プレビュー用に連結。 */
export function formatHashtags(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(" ");
}

/** JSON 文字列 or 配列を string[] に安全変換。 */
export function parseHashtagsJson(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
