// src/lib/slack/enterprise-inquiry.ts
//
// 「法人プランに申し込む」(= /pricing の法人カード CTA → FeedbackModal pricing mode) で
// フォーム送信されたタイミングの Slack 通知。
//
// 既存の feedback / oa-access-request 通知と同じ方針:
//   - webhook 未設定 → silent no-op (= notifySlack 内で吸収)
//   - 通知失敗時は throw → 呼び出し側で catch して console.error
//   - 個人情報は最小限 (= name / email / OA / 作品 / 入力本文 / userId)
//   - content は 2000 字 / それ以外は 200 字 で truncate
//   - webhook URL はログに出さない (= helper 側で吸収)

import { notifySlack } from "./notify";

const TRUNC_CONTENT = 2000;
const TRUNC_DEFAULT = 200;

function trunc(s: string | null | undefined, limit: number, fallback = "(なし)"): string {
  if (!s) return fallback;
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function detectEnv(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}

function formatJst(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export type EnterpriseInquiryNotifyInput = {
  id:        string;
  content:   string;
  userName?: string | null;
  userEmail?: string | null;
  /** 認証済みなら Supabase Auth userId。anonymous は null。 */
  userId?:   string | null;
  pageName?: string | null;
  pageUrl?:  string | null;
  oaId?:     string | null;
  oaName?:   string | null;
  workId?:   string | null;
  workName?: string | null;
  /** 希望プラン表示名（"Basic" / "委託プラン" など）。未指定 / 個人問い合わせは null。 */
  hopedPlan?: string | null;
  createdAt: Date;
};

export async function notifyEnterpriseInquirySubmitted(
  input: EnterpriseInquiryNotifyInput,
): Promise<void> {
  // 専用 webhook URL (= 一般 feedback とは別チャネル)。未設定なら notifySlack 側で no-op。
  const webhookUrl = process.env.ENTERPRISE_PLAN_SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const env    = detectEnv();
  const sentAt = formatJst(input.createdAt);

  const safeContent  = trunc(input.content, TRUNC_CONTENT, "(空)");
  const safeEmail    = trunc(input.userEmail, TRUNC_DEFAULT, "(unknown)");
  const safeName     = input.userName ? trunc(input.userName, TRUNC_DEFAULT) : null;
  const safeOaName   = trunc(input.oaName, TRUNC_DEFAULT);
  const safeWorkName = trunc(input.workName, TRUNC_DEFAULT);
  const safePageName = trunc(input.pageName, TRUNC_DEFAULT);
  const safeHopedPlan = input.hopedPlan ? trunc(input.hopedPlan, TRUNC_DEFAULT) : "(未選択)";

  // fallback text (= Slack 通知センター / non-block 表示用)
  const text = [
    `Whale Studio: 法人プラン申し込み [${env}]`,
    `送信日時: ${sentAt}`,
    `希望プラン: ${safeHopedPlan}`,
    `申込者: ${safeName ?? "(unknown)"}`,
    `メール: ${safeEmail}`,
    `userId: ${input.userId ?? "(anonymous)"}`,
    `OA: ${safeOaName}${input.oaId ? ` (${input.oaId})` : ""}`,
    `作品: ${safeWorkName}${input.workId ? ` (${input.workId})` : ""}`,
    `画面: ${safePageName}`,
    ``,
    `相談内容:`,
    safeContent,
  ].join("\n");

  // Block Kit (= リッチ表示)
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `法人プラン申し込み [${env}]` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*希望プラン*\n${safeHopedPlan}` },
        { type: "mrkdwn", text: `*申込者*\n${safeName ?? "(unknown)"}` },
        { type: "mrkdwn", text: `*メール*\n${safeEmail}` },
        { type: "mrkdwn", text: `*userId*\n${input.userId ?? "(anonymous)"}` },
        { type: "mrkdwn", text: `*送信日時*\n${sentAt}` },
        { type: "mrkdwn", text: `*OA*\n${safeOaName}${input.oaId ? `\n${input.oaId}` : ""}` },
        { type: "mrkdwn", text: `*作品*\n${safeWorkName}${input.workId ? `\n${input.workId}` : ""}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*相談内容 / メッセージ*\n${safeContent}` },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `画面: ${safePageName} / inquiry_id: \`${input.id}\`` },
      ],
    },
  ];

  await notifySlack({ webhookUrl, text, blocks });
}
