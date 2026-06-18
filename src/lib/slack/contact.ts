// src/lib/slack/contact.ts
//
// LIFF お問い合わせフォーム（page_type="contact"）送信時の Slack 通知。
//
// 呼び出し方（contact route の保存成功後・best-effort）:
//   notifyContactSubmitted({ ... }).catch((err) => console.warn("[contact] slack failed", { submissionId, workId, pageId }));
//
// 通知方針（feedback.ts / oa-access-request.ts と同方針）:
//   - webhook 未設定（CONTACT_FORM_SLACK_WEBHOOK_URL 空）→ silent no-op（notifySlack 内で吸収）
//   - 通知失敗時は throw → 呼び出し側で catch（業務処理＝保存/レスポンスは止めない）
//   - Slack 本文には PII（名前/メール/本文）を含めてよいが、ログには出さない
//   - 各項目は truncate して Slack block の長さ制限・縦伸びを防ぐ

import { notifySlack } from "./notify";

const TRUNC_BODY    = 300; // 本文（論理上限 100 だが防御的に 300）
const TRUNC_DEFAULT = 200;
const TRUNC_CUSTOM_VALUE = 120; // custom 1 項目の値
const TRUNC_CUSTOM_TOTAL = 1500; // custom 合算
const MAX_CUSTOM_ROWS = 20;

function trunc(s: string | null | undefined, limit: number, fallback = "(未入力)"): string {
  const v = (s ?? "").trim();
  if (v === "") return fallback;
  return v.length > limit ? `${v.slice(0, limit)}…` : v;
}

function detectEnv(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}

function formatJst(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function appBaseUrl(): string {
  const norm = (s: string | undefined | null) => {
    const v = (s ?? "").trim();
    return v === "" ? null : v.replace(/\/$/, "");
  };
  return (
    norm(process.env.NEXT_PUBLIC_APP_URL) ??
    norm(process.env.NEXT_PUBLIC_BASE_URL) ??
    "https://app.whale-studio.app"
  );
}

export type ContactCustomAnswer = { label: string; value: string };

export type ContactNotifyInput = {
  submissionId: string;
  workId:       string;
  workTitle?:   string | null;
  oaId:         string;
  oaName?:      string | null;
  pageId:       string;
  pageTitle?:   string | null;
  lineUserId?:  string | null;
  displayName?: string | null;
  category?:    string | null;
  name?:        string | null;
  email?:       string | null;
  body?:        string | null;
  customAnswers?: ContactCustomAnswer[] | null;
  createdAt:    Date;
};

/** custom answers を "*ラベル*\n値" の縦並びテキストに整形（truncate あり）。空なら null。 */
function formatCustomAnswers(items: ContactCustomAnswer[] | null | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const rows = items
    .slice(0, MAX_CUSTOM_ROWS)
    .map((a) => `*${trunc(a.label, 100, "(項目)")}*\n${trunc(a.value, TRUNC_CUSTOM_VALUE)}`);
  const joined = rows.join("\n");
  return joined.length > TRUNC_CUSTOM_TOTAL ? `${joined.slice(0, TRUNC_CUSTOM_TOTAL)}…` : joined;
}

/** 管理画面（回答結果）の絶対 URL。 */
export function buildContactAdminUrl(input: Pick<ContactNotifyInput, "oaId" | "workId" | "pageId">): string {
  return `${appBaseUrl()}/oas/${input.oaId}/works/${input.workId}/liff/pages/${input.pageId}/submissions`;
}

// Slack 通知メッセージ（text + blocks）を組み立てる純関数（副作用なし＝レイアウト検証可）。
export function buildContactMessage(
  input: ContactNotifyInput,
): { text: string; blocks: unknown[] } {
  const env    = detectEnv();
  const sentAt = formatJst(input.createdAt);
  const adminUrl = buildContactAdminUrl(input);

  const safeWork     = trunc(input.workTitle, TRUNC_DEFAULT, "(作品名なし)");
  const safeOa       = trunc(input.oaName, TRUNC_DEFAULT, "(OA名なし)");
  const safePage     = trunc(input.pageTitle, TRUNC_DEFAULT, "(ページ名なし)");
  const safeCategory = trunc(input.category, TRUNC_DEFAULT);
  const safeName     = trunc(input.name, TRUNC_DEFAULT);
  const safeEmail    = trunc(input.email, TRUNC_DEFAULT);
  const safeBody     = trunc(input.body, TRUNC_BODY, "(空)");
  const safeDisplay  = trunc(input.displayName, TRUNC_DEFAULT, "(なし)");
  const safeUserId   = input.lineUserId?.trim() || "(なし)";
  const customText   = formatCustomAnswers(input.customAnswers);

  const text = [
    `Whale Studio: 新しいお問い合わせが届きました [${env}]`,
    `送信日時: ${sentAt}`,
    `作品: ${safeWork}`,
    `LINE公式アカウント: ${safeOa}`,
    `ページ: ${safePage}`,
    `問い合わせ種別: ${safeCategory}`,
    `お名前: ${safeName}`,
    `メール: ${safeEmail}`,
    `内容: ${safeBody}`,
    ...(customText ? [`その他項目: ${customText.replace(/\n/g, " / ")}`] : []),
    `表示名: ${safeDisplay}`,
    `LINE userId: ${safeUserId}`,
    `submission_id: ${input.submissionId}`,
  ].join("\n");

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `新しいお問い合わせが届きました [${env}]` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*作品*\n${safeWork}` },
        { type: "mrkdwn", text: `*LINE公式アカウント*\n${safeOa}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*ページ*\n${safePage}` },
        { type: "mrkdwn", text: `*問い合わせ種別*\n${safeCategory}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*お名前*\n${safeName}` },
        { type: "mrkdwn", text: `*メールアドレス*\n${safeEmail}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*お問い合わせ内容*\n${safeBody}` },
    },
    ...(customText
      ? [{ type: "section", text: { type: "mrkdwn", text: `*その他項目*\n${customText}` } }]
      : []),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*表示名*\n${safeDisplay}` },
        { type: "mrkdwn", text: `*LINE userId*\n${safeUserId}` },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `送信日時: ${sentAt} / submission_id: \`${input.submissionId}\`` },
      ],
    },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "管理画面で確認" }, url: adminUrl },
      ],
    },
  ];

  return { text, blocks };
}

export async function notifyContactSubmitted(input: ContactNotifyInput): Promise<void> {
  const webhookUrl = process.env.CONTACT_FORM_SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // 未設定なら no-op

  const { text, blocks } = buildContactMessage(input);
  await notifySlack({ webhookUrl, text, blocks });
}
