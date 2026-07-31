// src/components/liff/completion-line-message.ts
//
// 完了後ボタン action="send_line_message" の送信処理（テスト対象・DOM 非依存）。
// LINE トークへ「CMS で設定した送信文言」を liff.sendMessages で送り、成功後 liff.closeWindow で閉じる。
//
// ※ 送信するのは常に message（送信文言）。ボタンに表示する label は画面表示専用で、
//    LINE へは絶対に送らない（label と message を混同しないこと）。
// UI（ボタン state / 文言）は SurveyCompletionButton が持つ。ここは送信判定と副作用のみ。

/** LIFF SDK の必要 API だけを型化（テストで最小 mock を注入できるようにする）。 */
export interface LiffLike {
  isInClient: () => boolean;
  sendMessages: (messages: Array<{ type: "text"; text: string }>) => Promise<unknown>;
  closeWindow: () => void;
}

export type CompletionMessageResult =
  | "sent" // 送信成功（または preview）。
  | "skipped" // 送信文言が空 / preview 以外で送る対象が無い → 何もしない。
  | "unsupported" // LIFF ブラウザ外など sendMessages 不可。
  | "error"; // 送信中の例外（回答データは保存済みなので失われない）。

/** 実機用: @line/liff を動的 import して LiffLike として返す。 */
async function loadLiff(): Promise<LiffLike> {
  const mod = await import("@line/liff");
  return mod.default as unknown as LiffLike;
}

/**
 * 完了後ボタンの LINE メッセージを送信する。
 * - message が空 / 空白のみ: "skipped"（空メッセージは送らない）。
 * - preview: LIFF を呼ばず "sent"（CMS プレビューで導線だけ確認する用）。
 * - 実機: isInClient() が false なら "unsupported"。sendMessages 成功で closeWindow して "sent"。
 * - 例外は握って "error"（技術的詳細は console にのみ記録し、プレイヤー画面には出さない）。
 */
export async function sendCompletionLineMessage(
  opts: { message: string | null | undefined; preview?: boolean; load?: () => Promise<LiffLike> },
): Promise<CompletionMessageResult> {
  const text = (opts.message ?? "").trim();
  if (text.length === 0) return "skipped";
  if (opts.preview) return "sent";
  try {
    const liff = await (opts.load ?? loadLiff)();
    if (!liff.isInClient()) return "unsupported";
    await liff.sendMessages([{ type: "text", text }]);
    liff.closeWindow();
    return "sent";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[SurveyCompletionButton] sendMessages failed:", err);
    return "error";
  }
}
