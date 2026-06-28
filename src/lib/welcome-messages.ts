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

/** あいさつメッセージ1件あたりの送信前待機の上限（秒）。1通目は reply で即時送信のため無視される。 */
export const WELCOME_DELAY_MAX_SECONDS = 8;

export type WelcomeMessageItem =
  | { type: "text"; text: string; delaySeconds?: number }
  | { type: "image"; imageUrl: string; previewImageUrl?: string; altText?: string; delaySeconds?: number };

function isHttpsUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("https://");
}

/**
 * delaySeconds を [0, WELCOME_DELAY_MAX_SECONDS] の整数に正規化する（runtime は throw しない）。
 *  未設定/非数/負 → 0、小数 → floor、上限超 → clamp。0 は呼び出し側で item に付けない。
 */
function normalizeDelaySeconds(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(WELCOME_DELAY_MAX_SECONDS, Math.max(0, Math.floor(v)));
}

function normalizeItem(raw: unknown): WelcomeMessageItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // 待機時間（0 は付けない＝全 0 のときは reply 一括の従来挙動を保つ）。
  const delay = normalizeDelaySeconds(o.delaySeconds);

  if (o.type === "text") {
    if (typeof o.text !== "string") return null;
    const text = o.text.trim();
    if (text.length < 1) return null; // 空テキストは除外
    const item: WelcomeMessageItem = { type: "text", text };
    if (delay > 0) item.delaySeconds = delay;
    return item;
  }

  if (o.type === "image") {
    if (!isHttpsUrl(o.imageUrl)) return null; // 画像 URL は https 必須
    const item: WelcomeMessageItem = { type: "image", imageUrl: o.imageUrl };
    if (isHttpsUrl(o.previewImageUrl)) item.previewImageUrl = o.previewImageUrl; // https のみ採用
    if (typeof o.altText === "string" && o.altText.trim().length > 0) item.altText = o.altText;
    if (delay > 0) item.delaySeconds = delay;
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
