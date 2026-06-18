/**
 * src/__tests__/contact-slack-message.test.ts
 *
 * src/lib/slack/contact.ts の buildContactMessage（純関数）+ notifyContactSubmitted の no-op を検証する。
 *
 * 検証観点:
 *   - 主要項目（作品/OA/ページ/種別/名前/メール/本文/表示名/userId/submission_id）を含む
 *   - 空項目を安全に "(未入力)" 等で扱う
 *   - customAnswers を表示できる
 *   - 長い body / custom 値を truncate する
 *   - CONTACT_FORM_SLACK_WEBHOOK_URL 未設定なら notifyContactSubmitted は no-op（throw しない）
 */
import { describe, it, expect } from "vitest";
import {
  buildContactMessage,
  buildContactAdminUrl,
  notifyContactSubmitted,
  type ContactNotifyInput,
} from "@/lib/slack/contact";

const base: ContactNotifyInput = {
  submissionId: "sub_123",
  workId:       "w1",
  workTitle:    "くじらと迷子のかけら",
  oaId:         "oa1",
  oaName:       "Whale Studio",
  pageId:       "p1",
  pageTitle:    "お問い合わせ",
  lineUserId:   "U1234567890",
  displayName:  "なみぽよ",
  category:     "不具合の報告",
  name:         "山田太郎",
  email:        "taro@example.com",
  body:         "ボタンが押せません",
  customAnswers: [{ label: "プラン", value: "Pro" }],
  createdAt:    new Date("2026-06-19T00:00:00Z"),
};

function flatText(blocks: unknown[]): string {
  return JSON.stringify(blocks);
}

describe("buildContactMessage", () => {
  it("主要項目を含む（text + blocks）", () => {
    const { text, blocks } = buildContactMessage(base);
    for (const v of ["くじらと迷子のかけら", "Whale Studio", "お問い合わせ", "不具合の報告", "山田太郎", "taro@example.com", "ボタンが押せません", "なみぽよ", "U1234567890", "sub_123"]) {
      expect(text).toContain(v);
    }
    expect(flatText(blocks)).toContain("新しいお問い合わせが届きました");
    expect(flatText(blocks)).toContain("プラン");
    expect(flatText(blocks)).toContain("Pro");
  });

  it("見出しに env タグが付く", () => {
    expect(buildContactMessage(base).text).toMatch(/\[.+\]/);
  });

  it("空項目は (未入力) / (なし) 等にフォールバック（落ちない）", () => {
    const { text, blocks } = buildContactMessage({
      ...base, category: "", name: "", email: null, body: "  ", displayName: null, lineUserId: null, customAnswers: [],
    });
    expect(text).toContain("お名前: (未入力)");
    expect(text).toContain("内容: (空)");
    expect(text).toContain("表示名: (なし)");
    expect(text).toContain("LINE userId: (なし)");
    // custom が空なら「その他項目」section は出ない
    expect(flatText(blocks)).not.toContain("その他項目");
  });

  it("長い body は truncate（… が付く）", () => {
    const { text } = buildContactMessage({ ...base, body: "あ".repeat(1000) });
    expect(text).toContain("…");
  });

  it("長い custom 値も truncate される", () => {
    const { blocks } = buildContactMessage({ ...base, customAnswers: [{ label: "詳細", value: "x".repeat(1000) }] });
    expect(flatText(blocks)).toContain("…");
  });

  it("管理画面 URL を含む（絶対 URL）", () => {
    const url = buildContactAdminUrl(base);
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("/oas/oa1/works/w1/liff/pages/p1/submissions");
    expect(flatText(buildContactMessage(base).blocks)).toContain(url);
  });
});

describe("notifyContactSubmitted — webhook 未設定で no-op", () => {
  it("CONTACT_FORM_SLACK_WEBHOOK_URL 未設定なら throw せず resolve", async () => {
    const prev = process.env.CONTACT_FORM_SLACK_WEBHOOK_URL;
    delete process.env.CONTACT_FORM_SLACK_WEBHOOK_URL;
    try {
      await expect(notifyContactSubmitted(base)).resolves.toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.CONTACT_FORM_SLACK_WEBHOOK_URL = prev;
    }
  });
});
