// src/lib/x-posts/intent.ts
// X（旧Twitter）への「手動投稿」導線用の純関数。
// X API での自動投稿ではなく、Web Intent（投稿作成画面）を開く URL を組み立てるだけ。
// クライアント安全（crypto 等のサーバー専用 API は使わない）。一覧/編集で共用する。

/** X Web Intent（投稿作成画面）のベース URL。text クエリに本文を渡す。 */
export const X_INTENT_BASE = "https://x.com/intent/tweet";

/** buildXPostText / buildXIntentUrl が参照する XPost の部分型（XPost にそのまま渡せる）。 */
export interface XPostIntentInput {
  body?: string | null;
  hashtags?: string[] | null;
  /** 計測URL（/r/... の短縮URL）。最優先で本文に載せる。 */
  tracking_url?: string | null;
  /** UTM 付き遷移先URL。tracking_url が無いときのフォールバック。 */
  generated_url?: string | null;
  /** 素の遷移先URL。上記が無いときの最終フォールバック。 */
  link_url?: string | null;
}

/**
 * 本文に載せる計測URLを選ぶ。優先順位は XPostPreviewCard と一致させる:
 *   計測URL(tracking_url) > UTM付きURL(generated_url) > 遷移先URL(link_url)。
 * いずれも無ければ空文字。
 */
export function pickTrackingUrl(post: XPostIntentInput): string {
  return (post.tracking_url || "").trim()
    || (post.generated_url || "").trim()
    || (post.link_url || "").trim();
}

/**
 * ハッシュタグを投稿本文用に連結する。
 * - 先頭に # が無ければ補完（parseHashtagsInput と同仕様）。
 * - 空要素は除外。半角スペース区切り。
 */
export function formatHashtagsForPost(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags
    .map((t) => (t ?? "").trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .join(" ");
}

/**
 * X 手動投稿用のテキストを組み立てる。
 * レイアウト（仕様）: 本文 / 空行 / 計測URL / 空行 / ハッシュタグ。
 * 空のセクションは詰める（例: 計測URL 無しなら 本文 + 空行 + ハッシュタグ）。
 * 改行は保持したまま encode するのは buildXIntentUrl 側の責務。
 */
export function buildXPostText(post: XPostIntentInput): string {
  const body = (post.body || "").trim();
  const url = pickTrackingUrl(post);
  const hashtags = formatHashtagsForPost(post.hashtags);
  return [body, url, hashtags].filter(Boolean).join("\n\n");
}

/**
 * X 投稿作成画面（Web Intent）を開く URL。
 * text は encodeURIComponent 済みで、改行（%0A）も保持される。
 * 本文が空（buildXPostText が空）の場合も URL 自体は返す（呼び出し側で disabled 制御する想定）。
 */
export function buildXIntentUrl(post: XPostIntentInput): string {
  const text = buildXPostText(post);
  return `${X_INTENT_BASE}?text=${encodeURIComponent(text)}`;
}
