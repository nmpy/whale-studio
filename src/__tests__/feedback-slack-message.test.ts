/**
 * src/__tests__/feedback-slack-message.test.ts
 *
 * src/lib/slack/feedback.ts の buildFeedbackMessage（純関数）を検証する。
 *
 * 検証観点:
 *   - Slack 表示に「カテゴリ」が出ない（廃止）
 *   - Slack 表示に「タイトル」が出る
 *   - LINE公式アカウント と uid が同じ fields section（左右）に並ぶ
 *   - uid / タイトル 未取得時は (なし) fallback
 */

import { describe, it, expect } from "vitest";
import { buildFeedbackMessage, type FeedbackNotifyInput } from "@/lib/slack/feedback";

const base: FeedbackNotifyInput = {
  id:        "fb_123",
  title:     "作品名がSlack通知に表示されない",
  content:   "ああああ",
  userId:    "051fc8cf-3298-40af-92d4-0fc26219bbfa",
  userName:  "なみぽよ",
  userEmail: "x@example.com",
  pageName:  "作品トップ",
  pageUrl:   "https://app.whale-studio.app/oas/oa1/works/w1/liff",
  oaId:      "oa1",
  oaName:    "Whale Studio",
  workId:    "w1",
  workName:  "くじらと迷子のかけら",
  createdAt: new Date("2026-06-18T00:00:00Z"),
};

// fields を持つ section ブロックを取り出すヘルパー。
type FieldSection = { type: string; fields?: { text: string }[] };
function fieldSections(blocks: unknown[]): FieldSection[] {
  return (blocks as FieldSection[]).filter(
    (b) => b?.type === "section" && Array.isArray(b.fields),
  );
}

describe("buildFeedbackMessage", () => {
  it("Slack 表示に『カテゴリ』ラベルが出ない", () => {
    const { text, blocks } = buildFeedbackMessage(base);
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("*カテゴリ*");
    expect(text).not.toContain("カテゴリ:");
  });

  it("Slack 表示に『タイトル』ラベルと値が出る", () => {
    const { text, blocks } = buildFeedbackMessage(base);
    const json = JSON.stringify(blocks);
    expect(json).toContain("*タイトル*");
    expect(json).toContain("作品名がSlack通知に表示されない");
    expect(text).toContain("タイトル: 作品名がSlack通知に表示されない");
  });

  it("LINE公式アカウント と uid が同じ fields section に並ぶ", () => {
    const { blocks } = buildFeedbackMessage(base);
    const sections = fieldSections(blocks);
    const oaUidSection = sections.find((s) =>
      s.fields!.some((f) => f.text.includes("*LINE公式アカウント*")) &&
      s.fields!.some((f) => f.text.includes("*uid*")),
    );
    expect(oaUidSection).toBeTruthy();
    // 左が LINE公式アカウント / 右が uid（配列順）。
    expect(oaUidSection!.fields![0].text).toContain("*LINE公式アカウント*");
    expect(oaUidSection!.fields![1].text).toContain("*uid*");
  });

  it("作品 と タイトル が同じ fields section に並ぶ", () => {
    const { blocks } = buildFeedbackMessage(base);
    const sections = fieldSections(blocks);
    const workTitleSection = sections.find((s) =>
      s.fields!.some((f) => f.text.includes("*作品*")) &&
      s.fields!.some((f) => f.text.includes("*タイトル*")),
    );
    expect(workTitleSection).toBeTruthy();
  });

  it("uid 未取得は (なし) にフォールバックする", () => {
    const { text, blocks } = buildFeedbackMessage({ ...base, userId: null });
    expect(JSON.stringify(blocks)).toContain("*uid*\\n(なし)");
    expect(text).toContain("uid: (なし)");
  });

  it("title 未取得は (なし) にフォールバックする", () => {
    const { blocks } = buildFeedbackMessage({ ...base, title: null });
    expect(JSON.stringify(blocks)).toContain("*タイトル*\\n(なし)");
  });

  it("通知タイトル『フィードバックが届きました』は維持される", () => {
    const { blocks } = buildFeedbackMessage(base);
    expect(JSON.stringify(blocks)).toContain("フィードバックが届きました");
  });
});
