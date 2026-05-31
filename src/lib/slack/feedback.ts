// src/lib/slack/feedback.ts
//
// 「気づいたこと」フォーム (= AppHeader の FeedbackModal) が
// 送信されたタイミングでの Slack 通知。
//
// 呼び出し方:
//   notifyFeedbackSubmitted({ ... }).catch((err) => console.error(...));
//
// 通知方針 (= oa-access-request.ts と同方針):
//   - webhook 未設定 → silent no-op (= notifySlack 内で吸収)
//   - 通知失敗時は throw → 呼び出し側で catch して console.error
//   - 個人情報は最小限 (= email / 名前 / OA / 作品 / 入力本文 / page_url)
//   - content は 1000 字 / それ以外は 200 字 / page_url は 400 字で truncate

import { notifySlack } from "./notify";

const TRUNC_CONTENT = 1000;
const TRUNC_DEFAULT = 200;
const TRUNC_URL     = 400;

function trunc(s: string | null | undefined, limit: number, fallback = "(なし)"): string {
  if (!s) return fallback;
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function detectEnv(): string {
  // Vercel 上では VERCEL_ENV が "production" | "preview" | "development"。
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}

function formatJst(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export type FeedbackNotifyInput = {
  id:         string;
  category:   string;
  content:    string;
  userName?:  string | null;
  userEmail?: string | null;
  pageName?:  string | null;
  pageUrl?:   string | null;
  oaId?:      string | null;
  oaName?:    string | null;
  workId?:    string | null;
  workName?:  string | null;
  createdAt:  Date;
};

export async function notifyFeedbackSubmitted(
  input: FeedbackNotifyInput,
): Promise<void> {
  const webhookUrl = process.env.FEEDBACK_SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const env    = detectEnv();
  const sentAt = formatJst(input.createdAt);

  const safeContent  = trunc(input.content, TRUNC_CONTENT, "(空)");
  const safeEmail    = trunc(input.userEmail, TRUNC_DEFAULT, "(unknown)");
  const safeName     = input.userName ? trunc(input.userName, TRUNC_DEFAULT) : null;
  const safeOaName   = trunc(input.oaName, TRUNC_DEFAULT);
  const safeWorkName = trunc(input.workName, TRUNC_DEFAULT);
  const safePageName = trunc(input.pageName, TRUNC_DEFAULT);
  const safePageUrl  = trunc(input.pageUrl, TRUNC_URL);

  // fallback text (= Slack 通知センター / non-block 表示用)
  const text = [
    `Whale Studio: 気づいたことが送信されました [${env}]`,
    `送信者: ${safeEmail}${safeName ? ` (${safeName})` : ""}`,
    `カテゴリ: ${input.category}`,
    `OA: ${safeOaName}${input.oaId ? ` (${input.oaId})` : ""}`,
    `作品: ${safeWorkName}${input.workId ? ` (${input.workId})` : ""}`,
    `画面: ${safePageName}`,
    `確認URL: ${safePageUrl}`,
    `送信日時: ${sentAt}`,
    ``,
    `内容:`,
    safeContent,
  ].join("\n");

  // Block Kit (= リッチ表示 / oa-access-request と同トーン)
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `気づいたことが送信されました [${env}]` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*送信者*\n${safeEmail}${safeName ? `\n${safeName}` : ""}` },
        { type: "mrkdwn", text: `*カテゴリ*\n${input.category}` },
        { type: "mrkdwn", text: `*OA*\n${safeOaName}` },
        { type: "mrkdwn", text: `*作品*\n${safeWorkName}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*内容*\n${safeContent}` },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `画面: ${safePageName} / 送信日時: ${sentAt} / feedback_id: \`${input.id}\`` },
      ],
    },
  ];

  if (input.pageUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "発生画面を開く" },
          url:  safePageUrl,
        },
      ],
    });
  }

  await notifySlack({ webhookUrl, text, blocks });
}
