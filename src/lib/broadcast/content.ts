// src/lib/broadcast/content.ts
//
// 配信メッセージの本文（contentJson）と LINE message 形式の変換。**配信専用**。
//
// 既存「応答メッセージ」の serializer（Message → LineMessage）は、フェーズ遷移 /
// quick reply / 自由入力 / delay など応答固有のロジックと結合しているため共有しない。
// 配信は「管理者が書いた本文をそのまま push する」だけなので、こちら側に閉じた
// 最小の変換を持つ。将来 Flex 等を足す場合もこのファイル内で完結させる。

/** 配信本文。MVP はテキストのみ。将来の形式追加に備えて kind を持たせる。 */
export type BroadcastContent = { kind: "text"; text: string };

/** LINE のテキストメッセージ 1 通あたりの上限。 */
export const BROADCAST_TEXT_MAX = 5000;

/** 未知の値を安全に BroadcastContent へ正規化する。不正なら null。 */
export function parseBroadcastContent(value: unknown): BroadcastContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.kind !== "text") return null;
  if (typeof o.text !== "string") return null;
  const text = o.text;
  if (text.trim() === "") return null;
  if (text.length > BROADCAST_TEXT_MAX) return null;
  return { kind: "text", text };
}

/** LINE Push API に渡す messages 配列へ変換する。 */
export function toLineMessages(content: BroadcastContent): { type: "text"; text: string }[] {
  return [{ type: "text", text: content.text }];
}
