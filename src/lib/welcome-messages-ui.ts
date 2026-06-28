// src/lib/welcome-messages-ui.ts
//
// あいさつメッセージ編集UI（共通設定タブ）のロジックを純関数に分離したもの。
// 画面（page.tsx）から参照し、unit test 可能にする（このリポジトリは jsdom/RTL 非導入）。
// API/型は #467（@/lib/welcome-messages の WelcomeMessageItem / GET·PATCH の welcome_messages）を利用。

import type { WelcomeMessageItem } from "./welcome-messages";
import { WELCOME_MESSAGES_MAX } from "./welcome-messages";

export { WELCOME_MESSAGES_MAX };
/** text item の最大文字数（保存 API の zod と一致）。 */
export const WELCOME_TEXT_MAX = 2000;

function isHttps(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("https://");
}

/**
 * 編集UIの初期 items を決める。
 *  1. welcome_messages が非空ならそれ
 *  2. 空で welcome_message が非空なら [{ type:"text", text }]（互換表示）
 *  3. どちらも空なら []
 */
export function initWelcomeItems(work: {
  welcome_messages?: WelcomeMessageItem[] | null;
  welcome_message?: string | null;
}): WelcomeMessageItem[] {
  if (work.welcome_messages && work.welcome_messages.length > 0) {
    return work.welcome_messages;
  }
  const single = work.welcome_message?.trim();
  if (single) return [{ type: "text", text: single }];
  return [];
}

export interface WelcomeValidationResult {
  ok: boolean;
  /** 全体エラー（null = なし）。 */
  overall: string | null;
  /** items と同 index の item 単位エラー（null = エラーなし）。 */
  itemErrors: (string | null)[];
}

/**
 * 保存前のクライアント側 validation（保存 API の zod と同条件）。
 */
/** 待機時間（秒）の上限。0〜WELCOME_DELAY_MAX_SECONDS の整数。 */
export const WELCOME_DELAY_MAX_SECONDS = 8;

/** delaySeconds が不正（非整数 / 範囲外）なら理由文言、正常 or 未設定なら null。 */
function delayError(v: number | undefined): string | null {
  if (v === undefined) return null;
  if (!Number.isInteger(v) || v < 0 || v > WELCOME_DELAY_MAX_SECONDS) {
    return `待機時間は0〜${WELCOME_DELAY_MAX_SECONDS}秒の整数で入力してください`;
  }
  return null;
}

export function validateWelcomeItems(items: WelcomeMessageItem[]): WelcomeValidationResult {
  const itemErrors: (string | null)[] = items.map((it) => {
    const dErr = delayError(it.delaySeconds);
    if (it.type === "text") {
      if (it.text.trim().length < 1) return "テキストを入力してください";
      if (it.text.length > WELCOME_TEXT_MAX) return `${WELCOME_TEXT_MAX}文字以内で入力してください`;
      return dErr;
    }
    // image
    if (!isHttps(it.imageUrl)) return "https の画像URLを設定してください";
    if (it.previewImageUrl !== undefined && !isHttps(it.previewImageUrl)) {
      return "プレビュー画像URLは https が必要です";
    }
    return dErr;
  });

  let overall: string | null = null;
  if (items.length > WELCOME_MESSAGES_MAX) {
    overall = `あいさつメッセージは最大${WELCOME_MESSAGES_MAX}件までです`;
  } else if (itemErrors.some((e) => e !== null)) {
    overall = "保存できない項目があります";
  }
  return { ok: overall === null, overall, itemErrors };
}

/**
 * item を上/下に移動した新配列を返す。境界（先頭の up / 末尾の down）は no-op（複製を返す）。
 */
export function moveWelcomeItem(
  items: WelcomeMessageItem[],
  index: number,
  dir: "up" | "down",
): WelcomeMessageItem[] {
  const target = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items.slice();
  }
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * 先頭 item（1通目）の delaySeconds を外す。1通目は reply で即時送信されるため待機を持たない（案B）。
 *  - 2件目以降の delaySeconds は保持
 *  - 元配列は破壊しない / 空配列はそのまま
 * 並び替え・削除で先頭に来た item の待機時間を正規化するために使う（保存時にも最終防御として適用）。
 */
export function dropFirstItemDelay(items: WelcomeMessageItem[]): WelcomeMessageItem[] {
  return items.map((it, i) => {
    if (i !== 0 || it.delaySeconds === undefined) return it;
    const { delaySeconds: _omit, ...rest } = it;
    return rest as WelcomeMessageItem;
  });
}

/**
 * 保存 payload を組み立てる。text は trim、image は imageUrl（＋設定済みの preview/alt のみ）。
 * 先頭 item の delaySeconds は必ず省略する（1通目は即時送信）。
 */
export function buildWelcomeMessagesPayload(
  items: WelcomeMessageItem[],
): { welcome_messages: WelcomeMessageItem[] } {
  const welcome_messages: WelcomeMessageItem[] = dropFirstItemDelay(items).map((it) =>
    it.type === "text"
      ? {
          type: "text",
          text: it.text.trim(),
          ...(it.delaySeconds ? { delaySeconds: it.delaySeconds } : {}),
        }
      : {
          type: "image",
          imageUrl: it.imageUrl,
          ...(it.previewImageUrl ? { previewImageUrl: it.previewImageUrl } : {}),
          ...(it.altText ? { altText: it.altText } : {}),
          ...(it.delaySeconds ? { delaySeconds: it.delaySeconds } : {}),
        },
  );
  return { welcome_messages };
}

/**
 * bootstrap の phases から開始フェーズの startTrigger を取り出す（未設定/空白は null）。
 */
export function getStartTriggerFromPhases(
  phases: { phase_type: string | null; start_trigger: string | null }[],
): string | null {
  const start = phases.find((p) => p.phase_type === "start");
  const t = start?.start_trigger?.trim();
  return t && t.length > 0 ? t : null;
}
