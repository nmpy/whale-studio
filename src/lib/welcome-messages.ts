// src/lib/welcome-messages.ts
//
// あいさつメッセージ（友だち追加時）の複数件・text/image 構造のパース/正規化。
//
// データは Work.welcomeMessagesJson(JSONB, default '[]') に保持する。
// webhook ランタイムで使うため、ここでは **絶対に throw しない**（不正は drop / 空化）。
// 不正 JSON・非配列・不正 item は安全に除外し、有効 item のみ最大 5 件を返す。
// 空（または全 drop）になった場合は呼び出し側で既存 Work.welcomeMessage に fallback する。

/** LINE は 1 リクエスト最大 5 メッセージのため、あいさつも最大 5 件。 */
export const WELCOME_MESSAGES_MAX = 5;

export type WelcomeMessageItem =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; previewImageUrl?: string; altText?: string };

function isHttpsUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("https://");
}

function normalizeItem(raw: unknown): WelcomeMessageItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (o.type === "text") {
    if (typeof o.text !== "string") return null;
    const text = o.text.trim();
    if (text.length < 1) return null; // 空テキストは除外
    return { type: "text", text };
  }

  if (o.type === "image") {
    if (!isHttpsUrl(o.imageUrl)) return null; // 画像 URL は https 必須
    const item: WelcomeMessageItem = { type: "image", imageUrl: o.imageUrl };
    if (isHttpsUrl(o.previewImageUrl)) item.previewImageUrl = o.previewImageUrl; // https のみ採用
    if (typeof o.altText === "string" && o.altText.trim().length > 0) item.altText = o.altText;
    return item;
  }

  return null; // 未知 type は除外
}

/**
 * Work.welcomeMessagesJson（Prisma Json: 配列 or JSON 文字列 or null/不正）を
 * 検証済みの WelcomeMessageItem[] に正規化する。最大 WELCOME_MESSAGES_MAX 件。
 * 不正・空は [] を返す（呼び出し側で welcomeMessage に fallback）。
 */
export function parseWelcomeMessages(value: unknown): WelcomeMessageItem[] {
  let arr: unknown = value;

  // Prisma の Json は通常パース済みの値だが、文字列で来た場合に備えてパースする。
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(arr)) return [];

  const out: WelcomeMessageItem[] = [];
  for (const raw of arr) {
    const item = normalizeItem(raw);
    if (item) out.push(item);
    if (out.length >= WELCOME_MESSAGES_MAX) break; // 6 件以上は切り詰め
  }
  return out;
}
