// src/lib/flex.ts
//
// LINE Flex Message (Messaging API) の JSON 正規化・検証ユーティリティ。
//
// ユーザーは LINE 公式 Flex Message Simulator (https://developers.line.biz/flex-simulator/)
// で作成した JSON を貼り付ける。許容する貼り付け形式は 2 パターン:
//   A) contents だけ                : { "type": "bubble" | "carousel", ... }
//   B) flex message 全体            : { "type": "flex", "altText": "...", "contents": { ... } }
//
// Whale Studio では DB に「contents (bubble/carousel)」と「altText」を分離して保存し
// (既存カラム flex_payload_json / alt_text を流用)、送信時に
//   { type: "flex", altText, contents }
// を組み立てて LINE Messaging API に渡す。
//
// セキュリティ: 貼り付け JSON は **必ず JSON.parse のみ**で解釈する (eval 禁止)。

export const FLEX_SIMULATOR_URL = "https://developers.line.biz/flex-simulator/";
export const FLEX_DEFAULT_ALT_TEXT = "Flex Message";
export const FLEX_ALT_TEXT_MAX = 400;

/** フォーム / API 双方で共有するエラーメッセージ。 */
export const FLEX_ERRORS = {
  invalidJson: "JSONの形式が正しくありません。Flex Message SimulatorからコピーしたJSONを貼り付けてください。",
  badType: 'Flex Message JSONには type: "bubble" または type: "carousel" が必要です。',
  emptyAltText: "代替テキストを入力してください。",
} as const;

/** Flex contents (bubble / carousel) の最小型。中身は LINE 仕様に委ねる。 */
export type FlexContents = { type: string; [key: string]: unknown };

export type NormalizedFlex = {
  /** bubble / carousel の contents オブジェクト (= DB flex_payload_json へ保存する値)。 */
  contents: FlexContents;
  /** 全体貼り付け (パターンB) のとき JSON 内にあった altText (なければ null)。 */
  altTextFromJson: string | null;
};

function isFlexContainer(v: unknown): v is FlexContents {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const t = (v as Record<string, unknown>).type;
  return t === "bubble" || t === "carousel";
}

/**
 * 貼り付け JSON を parse し、contents (bubble/carousel) を抽出して正規化する。
 * パターンA (contents のみ) / パターンB (flex 全体) の両方を許容する。
 * eval は使わず JSON.parse のみ。
 */
export function normalizeFlexJson(
  raw: string | null | undefined,
): { ok: true; value: NormalizedFlex } | { ok: false; error: string } {
  if (!raw || !raw.trim()) return { ok: false, error: FLEX_ERRORS.invalidJson };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: FLEX_ERRORS.invalidJson };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: FLEX_ERRORS.badType };
  }
  const obj = parsed as Record<string, unknown>;

  // パターンB: flex message 全体
  if (obj.type === "flex") {
    if (!isFlexContainer(obj.contents)) return { ok: false, error: FLEX_ERRORS.badType };
    const altTextFromJson =
      typeof obj.altText === "string" && obj.altText.trim() ? obj.altText : null;
    return { ok: true, value: { contents: obj.contents, altTextFromJson } };
  }

  // パターンA: contents (bubble / carousel) だけ
  if (isFlexContainer(obj)) {
    return { ok: true, value: { contents: obj, altTextFromJson: null } };
  }

  return { ok: false, error: FLEX_ERRORS.badType };
}

/** altText を解決する (フォーム値 → JSON 内 altText の順)。trim + 最大長 clamp。空なら null。 */
export function resolveFlexAltText(
  altText: string | null | undefined,
  fromJson: string | null = null,
): string | null {
  const candidate = altText?.trim() || fromJson?.trim() || "";
  if (!candidate) return null;
  return candidate.slice(0, FLEX_ALT_TEXT_MAX);
}

/** 貼り付け JSON を整形表示用に pretty-print する (parse 失敗時は原文を返す)。 */
export function prettyFlexJson(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * 保存済み flex_payload_json + alt_text から LINE 送信用 { altText, contents } を組み立てる。
 * 不正/未設定なら null (= 呼び出し側でフォールバック)。
 */
export function buildFlexSendParts(
  flexPayloadJson: string | null | undefined,
  altText: string | null | undefined,
): { altText: string; contents: FlexContents } | null {
  const norm = normalizeFlexJson(flexPayloadJson);
  if (!norm.ok) return null;
  const alt = resolveFlexAltText(altText, norm.value.altTextFromJson) ?? FLEX_DEFAULT_ALT_TEXT;
  return { altText: alt.slice(0, FLEX_ALT_TEXT_MAX), contents: norm.value.contents };
}
