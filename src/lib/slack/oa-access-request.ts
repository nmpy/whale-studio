// src/lib/slack/oa-access-request.ts
//
// OA 権限申請 (= OaOnboardingRequest) が SUBMITTED に遷移した時の Slack 通知。
//
// 呼び出し方:
//   notifyOaAccessRequestSubmitted({ ... }).catch((err) => console.error(...));
//
// 通知方針:
//   - webhook 未設定 → silent no-op (= notifySlack 内で吸収)
//   - 通知失敗時は throw → 呼び出し側で catch して console.error
//   - 個人情報は最小限 (= email / userId / OA 名 / request_id / 申請日時 / 確認 URL)
//   - 長すぎる値は truncate (= Slack 側でレイアウト崩れを防ぐ / secret leak 防止)

import { notifySlack } from "./notify";

const TRUNC = 200;

function trunc(s: string | null | undefined, limit = TRUNC): string {
  if (!s) return "(unknown)";
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function detectEnv(): string {
  // Vercel 上では VERCEL_ENV が "production" | "preview" | "development" のいずれかになる。
  // ローカル開発では NODE_ENV にフォールバック。
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}

function formatJst(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export type OaAccessRequestNotifyInput = {
  email:       string | null | undefined;
  userId:      string;
  username?:   string | null;
  oaName?:     string | null;
  requestId:   string;
  submittedAt: Date;
};

export async function notifyOaAccessRequestSubmitted(
  input: OaAccessRequestNotifyInput,
): Promise<void> {
  const webhookUrl = process.env.OA_ACCESS_REQUEST_SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const adminUrl = appUrl
    ? `${appUrl.replace(/\/$/, "")}/admin/oa-onboarding`
    : "/admin/oa-onboarding";
  const env      = detectEnv();
  const sentAt   = formatJst(input.submittedAt);

  const safeEmail    = trunc(input.email);
  const safeUsername = input.username ? trunc(input.username) : null;
  const safeOaName   = trunc(input.oaName);

  // fallback text (= Slack 通知センターや non-block 表示で使われる)
  const text = [
    `Whale Studio: OA権限申請が届きました [${env}]`,
    `申請者: ${safeEmail}${safeUsername ? ` (${safeUsername})` : ""}`,
    `user_id: ${input.userId}`,
    `対象OA: ${safeOaName}`,
    `request_id: ${input.requestId}`,
    `申請日時: ${sentAt}`,
    `確認URL: ${adminUrl}`,
  ].join("\n");

  // Block Kit (= リッチ表示)
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `OA権限申請が届きました [${env}]` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*申請者*\n${safeEmail}${safeUsername ? `\n${safeUsername}` : ""}` },
        { type: "mrkdwn", text: `*対象OA*\n${safeOaName}` },
        { type: "mrkdwn", text: `*申請日時*\n${sentAt}` },
        { type: "mrkdwn", text: `*request_id*\n\`${input.requestId}\`` },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `user_id: \`${input.userId}\`` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type:  "button",
          text:  { type: "plain_text", text: "確認画面を開く" },
          url:   adminUrl,
          style: "primary",
        },
      ],
    },
  ];

  await notifySlack({ webhookUrl, text, blocks });
}
