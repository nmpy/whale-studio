// src/lib/broadcast/content.ts
//
// 配信メッセージの本文（contentJson）と LINE message 形式の変換。**配信専用**。
//
// 既存「応答メッセージ」の serializer（Message → LineMessage）は、フェーズ遷移 /
// quick reply / 自由入力 / delay など応答固有のロジックと結合しているため共有しない。
// 配信は「管理者が書いた本文をそのまま push する」だけなので、こちら側に閉じた
// 最小の変換を持つ。形式（テキスト / 画像 / Flex）の追加もこのファイル内で完結させる。
//
// ■ 後方互換
//   Production の既存 Broadcast は contentJson = {"kind":"text","text":"..."} で保存されている。
//   kind が最初から判別子として入っているため、**version フィールドも migration も追加せず**
//   union を広げるだけで既存データがそのまま parse できる。既存レコードは書き換えない。
//
// ■ 送信基盤は触らない
//   宛先解決 / recipient snapshot / CAS / X-Line-Retry-Key / retry 分類 / 集計 / cron worker は
//   このファイルの変更とは無関係。processBroadcastChunk は今までどおり
//   parseBroadcastContent() → toLineMessages() を呼ぶだけで新形式に対応する。

/** Flex の最上位コンテナ。LINE 仕様上 bubble / carousel のみが許される。 */
export type BroadcastFlexContainer = { type: "bubble" | "carousel"; [key: string]: unknown };

/** 配信本文。テキスト / 画像 / Flex。 */
export type BroadcastContent =
  | { kind: "text"; text: string }
  | { kind: "image"; originalContentUrl: string; previewImageUrl: string }
  | { kind: "flex"; altText: string; contents: BroadcastFlexContainer };

export type BroadcastContentKind = BroadcastContent["kind"];

/** LINE のテキストメッセージ 1 通あたりの上限。 */
export const BROADCAST_TEXT_MAX = 5000;
/** 画像 URL の最大文字数（LINE 仕様）。 */
export const BROADCAST_MEDIA_URL_MAX = 2000;
/** Flex の altText 最大文字数（LINE 仕様: Max character limit 1500）。 */
export const BROADCAST_ALT_TEXT_MAX = 1500;
/** Flex の最上位に許可するコンテナ型。 */
export const BROADCAST_FLEX_CONTAINER_TYPES = ["bubble", "carousel"] as const;
/** Flex コンテナ JSON のサイズ上限（LINE 仕様: bubble 30KB / carousel 50KB）。 */
export const BROADCAST_FLEX_BUBBLE_MAX_BYTES = 30 * 1024;
export const BROADCAST_FLEX_CAROUSEL_MAX_BYTES = 50 * 1024;

/**
 * 画像 URL として受け入れてよい文字列か。
 *
 * LINE の要求（HTTPS / TLS 1.2 以上）に加えて、管理画面から任意文字列が入ってくる前提で
 * **scheme を https に限定**する。これにより javascript: / data: / file: / blob: は
 * 個別に列挙するまでもなく弾かれる（許可リスト方式）。
 * TLS バージョンは URL 文字列からは判定できないため、ここでは検証せず LINE 側に委ねる。
 */
export function isSendableImageUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s === "" || s.length > BROADCAST_MEDIA_URL_MAX) return false;
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.hostname === "") return false;
  // URL に埋め込まれた資格情報は受け付けない（意図しない資格情報の保存・露出を防ぐ）
  if (u.username !== "" || u.password !== "") return false;
  return true;
}

/**
 * Flex の最上位コンテナとして妥当か（bubble / carousel のみ）。
 * LINE 仕様のサイズ上限（bubble 30KB / carousel 50KB）も併せて確認する。
 */
export function isBroadcastFlexContainer(v: unknown): v is BroadcastFlexContainer {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const t = (v as Record<string, unknown>).type;
  if (t !== "bubble" && t !== "carousel") return false;
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(v), "utf8"); } catch { return false; }
  const max = t === "bubble" ? BROADCAST_FLEX_BUBBLE_MAX_BYTES : BROADCAST_FLEX_CAROUSEL_MAX_BYTES;
  return bytes <= max;
}

/**
 * 未知の値を安全に BroadcastContent へ正規化する。不正なら null。
 *
 * **JSON.parse に成功したこと＝valid とは扱わない。** kind ごとに個別に検証し、
 * 未知の kind は必ず reject する。ここを通らないものは LINE へ送られない
 * （processBroadcastChunk は null なら invalid_content として送信しない）。
 */
export function parseBroadcastContent(value: unknown): BroadcastContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;

  switch (o.kind) {
    case "text": {
      if (typeof o.text !== "string") return null;
      const text = o.text;
      if (text.trim() === "") return null;
      if (text.length > BROADCAST_TEXT_MAX) return null;
      return { kind: "text", text };
    }

    case "image": {
      // 両方必須。preview 省略時に original で代替すると 1MB 上限に違反しうるため補完しない。
      if (!isSendableImageUrl(o.originalContentUrl)) return null;
      if (!isSendableImageUrl(o.previewImageUrl)) return null;
      return {
        kind: "image",
        originalContentUrl: (o.originalContentUrl as string).trim(),
        previewImageUrl:    (o.previewImageUrl as string).trim(),
      };
    }

    case "flex": {
      if (typeof o.altText !== "string") return null;
      const altText = o.altText.trim();
      if (altText === "" || altText.length > BROADCAST_ALT_TEXT_MAX) return null;
      // contents は管理者が貼り付けた JSON。最上位が bubble / carousel であることだけを
      // こちらで保証し、内部構造の妥当性は LINE 公式の validate API に委ねる
      // （Whale 側に Flex パーサを再実装しない）。
      if (!isBroadcastFlexContainer(o.contents)) return null;
      return { kind: "flex", altText, contents: o.contents };
    }

    // 未知の kind（将来形式 / 壊れたデータ / 手書き JSON）は送らない
    default:
      return null;
  }
}

/** LINE message object（配信で使う分だけの最小型）。 */
export type BroadcastLineMessage =
  | { type: "text"; text: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string }
  | { type: "flex"; altText: string; contents: BroadcastFlexContainer };

/**
 * LINE Push API に渡す messages 配列へ変換する。
 *
 * **1 Broadcast = 1 LINE message object**（配列長は常に 1）。
 * LINE の push は 1 リクエスト最大 5 通だが、複数通のシーケンス配信は今回扱わない。
 * `type` は必ずここで Whale 側が付与する（管理者入力の JSON をそのまま素通ししない）。
 */
export function toLineMessages(content: BroadcastContent): BroadcastLineMessage[] {
  switch (content.kind) {
    case "text":
      return [{ type: "text", text: content.text }];
    case "image":
      return [{
        type: "image",
        originalContentUrl: content.originalContentUrl,
        previewImageUrl:    content.previewImageUrl,
      }];
    case "flex":
      return [{ type: "flex", altText: content.altText, contents: content.contents }];
  }
}

/** 管理画面の一覧・履歴に出す形式ラベル。 */
export const BROADCAST_CONTENT_KIND_LABEL: Record<BroadcastContentKind, string> = {
  text:  "テキスト",
  image: "画像",
  flex:  "Flex",
};
