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
export function validateWelcomeItems(items: WelcomeMessageItem[]): WelcomeValidationResult {
  const itemErrors: (string | null)[] = items.map((it) => {
    if (it.type === "text") {
      if (it.text.trim().length < 1) return "テキストを入力してください";
      if (it.text.length > WELCOME_TEXT_MAX) return `${WELCOME_TEXT_MAX}文字以内で入力してください`;
      return null;
    }
    // image
    if (!isHttps(it.imageUrl)) return "https の画像URLを設定してください";
    if (it.previewImageUrl !== undefined && !isHttps(it.previewImageUrl)) {
      return "プレビュー画像URLは https が必要です";
    }
    return null;
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

/** あいさつ送信前の「入力中…」演出の最大秒数（0〜8）。0=演出なし。 */
export const WELCOME_LOADING_MAX_SECONDS = 8;

/**
 * 入力中演出の秒数を [0, WELCOME_LOADING_MAX_SECONDS] の整数に正規化する（UI 表示・保存防御用）。
 *  非数/負 → 0、小数 → floor、上限超 → clamp。
 */
export function clampWelcomeLoadingSeconds(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(WELCOME_LOADING_MAX_SECONDS, Math.max(0, Math.floor(v)));
}

/**
 * 保存 payload を組み立てる。text は trim、image は imageUrl（＋設定済みの preview/alt のみ）。
 * loadingSeconds に number を渡すと welcome_loading_seconds（0〜8 に clamp）を含める。
 * 未指定なら従来どおり welcome_messages のみ（既存テスト互換）。
 */
export function buildWelcomeMessagesPayload(
  items: WelcomeMessageItem[],
  loadingSeconds?: number,
): { welcome_messages: WelcomeMessageItem[]; welcome_loading_seconds?: number } {
  const welcome_messages: WelcomeMessageItem[] = items.map((it) =>
    it.type === "text"
      ? { type: "text", text: it.text.trim() }
      : {
          type: "image",
          imageUrl: it.imageUrl,
          ...(it.previewImageUrl ? { previewImageUrl: it.previewImageUrl } : {}),
          ...(it.altText ? { altText: it.altText } : {}),
        },
  );
  if (typeof loadingSeconds === "number") {
    return { welcome_messages, welcome_loading_seconds: clampWelcomeLoadingSeconds(loadingSeconds) };
  }
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

/**
 * bootstrap の phases から開始フェーズの id を取り出す（無ければ null）。
 * 共通設定タブから startTrigger を編集する際の phaseApi.update 対象 id に使う。
 */
export function getStartPhaseId(
  phases: { id: string; phase_type: string | null }[],
): string | null {
  return phases.find((p) => p.phase_type === "start")?.id ?? null;
}

/**
 * 開始クイックリプライ文言（= startTrigger）の保存値を正規化する。
 * trim・改行除去。空なら null（未設定→QR非表示）。
 * 文字数上限（API zod の max 200）は呼び出し側で別途チェックする。
 */
export function normalizeStartTrigger(v: string): string | null {
  const t = v.replace(/[\r\n]+/g, " ").trim();
  return t.length > 0 ? t : null;
}
