// src/lib/slack/feedback.ts
//
// 「フィードバックを送る」フォーム (= AppHeader の FeedbackModal) が
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
import { formatFeedbackCategory } from "@/lib/feedback/format";

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

// pageUrl が送信ページの URL を含む場合、表示確認モード関連のクエリパラメータを抽出する。
// 解析失敗時は null/null を返す (= 表示確認モードではない or URL 不正)。
function extractPreviewParams(pageUrl: string | null | undefined): {
  previewPlan: string | null;
  previewRole: string | null;
} {
  if (!pageUrl) return { previewPlan: null, previewRole: null };
  try {
    const u = new URL(pageUrl);
    return {
      previewPlan: u.searchParams.get("previewPlan"),
      previewRole: u.searchParams.get("previewRole"),
    };
  } catch {
    return { previewPlan: null, previewRole: null };
  }
}

export type FeedbackNotifyInput = {
  id:         string;
  category:   string;
  content:    string;
  /** 認証済みなら Supabase Auth userId。anonymous は null。 */
  userId?:    string | null;
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
  // 送信者表示はユーザー名を主とする (= route 側で username → 氏名 → email → "未設定ユーザー" の
  // 優先順で解決済みの値が userName に入る)。email は traceability 用に副表示で残す。
  const safeName     = input.userName ? trunc(input.userName, TRUNC_DEFAULT) : "未設定ユーザー";
  const safeOaName   = trunc(input.oaName, TRUNC_DEFAULT);
  const safeWorkName = trunc(input.workName, TRUNC_DEFAULT);
  const safePageName = trunc(input.pageName, TRUNC_DEFAULT);
  const safePageUrl  = trunc(input.pageUrl, TRUNC_URL);
  // カテゴリは内部値（bug/ux/feature/other）を表示用に日本語化する。
  const safeCategory = formatFeedbackCategory(input.category);

  // 表示確認モード (= owner 限定 URL クエリ) の検出。
  // pageUrl から抽出するため、表示確認していないユーザーには付かない。
  const { previewPlan, previewRole } = extractPreviewParams(input.pageUrl);
  const previewLine =
    previewPlan || previewRole
      ? `previewPlan=${previewPlan ?? "(なし)"} / previewRole=${previewRole ?? "(なし)"}`
      : null;

  // fallback text (= Slack 通知センター / non-block 表示用)
  // 読み順: 送信者 → LINE公式アカウント → 作品 → uid → カテゴリ → 内容。
  const text = [
    `Whale Studio: フィードバックが届きました [${env}]`,
    `送信日時: ${sentAt}`,
    `送信者: ${safeName}${input.userEmail ? ` (${safeEmail})` : ""}`,
    `LINE公式アカウント: ${safeOaName}${input.oaId ? ` (${input.oaId})` : ""}`,
    `作品: ${safeWorkName}${input.workId ? ` (${input.workId})` : ""}`,
    `uid: ${input.userId ?? "(anonymous)"}`,
    `カテゴリ: ${safeCategory}`,
    `画面: ${safePageName}`,
    `確認URL: ${safePageUrl}`,
    ...(previewLine ? [`表示確認モード: ${previewLine}`] : []),
    ``,
    `内容:`,
    safeContent,
  ].join("\n");

  // Block Kit (= リッチ表示 / oa-access-request と同トーン)
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `フィードバックが届きました [${env}]` },
    },
    // fields は配列順に 2 列 (左→右→次の行) で並ぶため、
    // 読み順が「送信者 → LINE公式アカウント → 作品 → uid → カテゴリ」になるよう並べる。
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*送信者*\n${safeName}${input.userEmail ? `\n${safeEmail}` : ""}` },
        { type: "mrkdwn", text: `*LINE公式アカウント*\n${safeOaName}` },
        { type: "mrkdwn", text: `*作品*\n${safeWorkName}` },
        { type: "mrkdwn", text: `*uid*\n${input.userId ?? "(anonymous)"}` },
        { type: "mrkdwn", text: `*カテゴリ*\n${safeCategory}` },
      ],
    },
    // 内容は長くなるため単独ブロックにする。
    {
      type: "section",
      text: { type: "mrkdwn", text: `*内容*\n${safeContent}` },
    },
    ...(previewLine
      ? [
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `*表示確認モード* ${previewLine}` },
            ],
          },
        ]
      : []),
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
