// src/components/liff/register-report.ts
//
// 「登録完了を本部へ報告する」導線の純粋ロジック（テスト対象・DOM 非依存）。
// LIFF トークへ固定メッセージを liff.sendMessages で送信し、成功後 liff.closeWindow で閉じる。
// UI（ボタン state / 文言）は LineRegisterReportButton が持つ。ここは送信判定と副作用のみ。

/**
 * 本部へ送る固定メッセージ。句読点を含め固定（LINE 公式アカウント側で完全一致 / キーワード一致の
 * 自動応答トリガーに使うため、絶対に変更しない）。
 */
export const REGISTER_REPORT_MESSAGE = "エージェント登録を完了しました。" as const;

/** LIFF SDK の必要 API だけを型化（テストで最小 mock を注入できるようにする）。 */
export interface LiffLike {
  isInClient: () => boolean;
  sendMessages: (messages: Array<{ type: "text"; text: string }>) => Promise<unknown>;
  closeWindow: () => void;
}

export type RegisterReportResult =
  | "sent" // 送信成功（または preview）。呼び出し側は完了表示にする。
  | "unsupported" // LIFF ブラウザ外など sendMessages 不可 → 手動送信を案内する。
  | "error"; // 送信中の例外 → 手動送信を案内する（回答データは保持済み）。

/** 実機用: @line/liff を動的 import して LiffLike として返す（外部ブラウザでも import 自体は通る）。 */
async function loadLiff(): Promise<LiffLike> {
  const mod = await import("@line/liff");
  return mod.default as unknown as LiffLike;
}

/**
 * 完了報告を送信する。
 * - preview: LIFF を呼ばず "sent"（管理プレビューで導線だけ確認する用）。
 * - 実機: isInClient() が false なら "unsupported"。sendMessages 成功で closeWindow して "sent"。
 * - 例外は握って "error"（回答保存済みのためデータは失われない）。技術的詳細は console にのみ記録。
 */
export async function sendRegisterReport(opts: { preview?: boolean; load?: () => Promise<LiffLike> } = {}): Promise<RegisterReportResult> {
  if (opts.preview) return "sent";
  try {
    const liff = await (opts.load ?? loadLiff)();
    if (!liff.isInClient()) return "unsupported";
    await liff.sendMessages([{ type: "text", text: REGISTER_REPORT_MESSAGE }]);
    liff.closeWindow();
    return "sent";
  } catch (err) {
    // 技術的なエラー内容はプレイヤー画面に出さず console にのみ残す。
    // eslint-disable-next-line no-console
    console.warn("[LineRegisterReport] sendMessages failed:", err);
    return "error";
  }
}
