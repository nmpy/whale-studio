// src/lib/slack/business-application.ts
//
// 法人招待リンクの「申込フォーム送信」タイミングの Slack 通知 (= Phase2)。
//
// webhook の優先順位 (= ユーザー要件):
//   1. BUSINESS_INVITE_SLACK_WEBHOOK_URL   (= 専用チャネル)
//   2. ENTERPRISE_PLAN_SLACK_WEBHOOK_URL   (= 既存の法人相談チャネルへフォールバック)
//   3. どちらも未設定 → no-op + warn log (= 業務処理は止めない)
//
// 既存 enterprise-inquiry と同じ方針:
//   - 通知失敗時は throw → 呼び出し側で catch して console.error
//   - 個人情報は最小限・truncate
//   - webhook URL はログに出さない (= notifySlack helper 側で吸収)

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

export type BusinessApplicationNotifyInput = {
  applicationId:           string;
  linkId:                  string;
  companyName:             string;
  contactName:             string;
  contactEmail:            string;
  lineOfficialAccountName?: string | null;
  message?:                string | null;
  /** 申込時点の link スナップショット */
  planLabel:               string;  // 表示名 (= "Basic" / "委託プラン" など)
  roleLabel:               string;  // 表示名 (= "管理者" など)
  usageTypeLabel:          string;  // 表示名 (= "法人利用" など)
  /** 認証済みなら申込者の Supabase userId */
  submittedByUserId?:      string | null;
  createdAt:               Date;
};

export async function notifyBusinessApplicationSubmitted(
  input: BusinessApplicationNotifyInput,
): Promise<void> {
  // webhook 優先順位: 専用 → enterprise フォールバック → no-op+warn
  const webhookUrl =
    process.env.BUSINESS_INVITE_SLACK_WEBHOOK_URL ||
    process.env.ENTERPRISE_PLAN_SLACK_WEBHOOK_URL ||
    "";
  if (!webhookUrl) {
    console.warn(
      "[business-application] Slack webhook 未設定 (BUSINESS_INVITE_SLACK_WEBHOOK_URL / " +
      "ENTERPRISE_PLAN_SLACK_WEBHOOK_URL いずれも未設定) — 通知をスキップします。",
    );
    return;
  }

  const env    = detectEnv();
  const sentAt = formatJst(input.createdAt);

  const safeCompany = trunc(input.companyName, TRUNC_DEFAULT, "(未入力)");
  const safeContact = trunc(input.contactName, TRUNC_DEFAULT, "(未入力)");
  const safeEmail   = trunc(input.contactEmail, TRUNC_DEFAULT, "(未入力)");
  const safeLineOa  = input.lineOfficialAccountName ? trunc(input.lineOfficialAccountName, TRUNC_DEFAULT) : "(未入力)";
  const safeMessage = trunc(input.message, TRUNC_CONTENT);

  // fallback text (= Slack 通知センター / non-block 表示用)
  const text = [
    `Whale Studio: 法人申込が届きました [${env}]`,
    `送信日時: ${sentAt}`,
    `付与予定: ${input.usageTypeLabel} / ${input.planLabel} / ${input.roleLabel}`,
    `会社・団体: ${safeCompany}`,
    `担当者: ${safeContact}`,
    `メール: ${safeEmail}`,
    `LINE公式アカウント名: ${safeLineOa}`,
    `userId: ${input.submittedByUserId ?? "(anonymous)"}`,
    ``,
    `相談内容 / 備考:`,
    safeMessage,
  ].join("\n");

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `法人申込が届きました [${env}]` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*付与予定プラン*\n${input.planLabel}` },
        { type: "mrkdwn", text: `*付与予定ロール*\n${input.roleLabel}` },
        { type: "mrkdwn", text: `*利用区分*\n${input.usageTypeLabel}` },
        { type: "mrkdwn", text: `*送信日時*\n${sentAt}` },
        { type: "mrkdwn", text: `*会社 / 団体*\n${safeCompany}` },
        { type: "mrkdwn", text: `*担当者*\n${safeContact}` },
        { type: "mrkdwn", text: `*メール*\n${safeEmail}` },
        { type: "mrkdwn", text: `*LINE公式アカウント名*\n${safeLineOa}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*相談内容 / 備考*\n${safeMessage}` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `userId: ${input.submittedByUserId ?? "(anonymous)"} / ` +
            `application_id: \`${input.applicationId}\` / link_id: \`${input.linkId}\``,
        },
      ],
    },
  ];

  await notifySlack({ webhookUrl, text, blocks });
}
