// src/lib/slack/notify.ts
//
// Slack Incoming Webhook への通知共通ヘルパー。
//
// 設計:
//   - webhookUrl が未設定 (= undefined / null / "") なら silent no-op (= 例外も throw しない)
//   - HTTP エラー (= 非 2xx) は throw する。呼び出し側で catch し、業務処理を止めないこと
//   - webhook URL 自体はログに出力しない (= secret)
//   - text + blocks の両方を受けて Slack 側でリッチ表示できるようにする
//
// 用途別に webhook を分ける運用 (= `OA_ACCESS_REQUEST_SLACK_WEBHOOK_URL` /
// `FEEDBACK_SLACK_WEBHOOK_URL` 等) を想定。webhook URL の取得は本ヘルパーの外で行い、
// ここでは渡された URL に POST するだけのシンプルな責務に留める。

export type NotifySlackInput = {
  /** Slack Incoming Webhook URL。未設定なら no-op */
  webhookUrl?: string | null;
  /** Slack 通知本文 (= fallback テキスト / 通知センター表示にも使われる) */
  text: string;
  /** Block Kit blocks (= リッチ表示用、optional) */
  blocks?: unknown[];
};

export async function notifySlack(input: NotifySlackInput): Promise<void> {
  const { webhookUrl, text, blocks } = input;
  if (!webhookUrl) return;

  const res = await fetch(webhookUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text, blocks }),
  });

  if (!res.ok) {
    const bodySnippet = await res.text().catch(() => "");
    // webhook URL 自体はログに残さない (= secret) / status + 先頭 200 文字だけ含める
    throw new Error(
      `Slack webhook responded ${res.status}: ${bodySnippet.slice(0, 200)}`,
    );
  }
}
