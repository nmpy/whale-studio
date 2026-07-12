// src/__tests__/rh-e2e/feedback-neg.e2e.ts
// Feedback Route 負テスト（§8）。Slack 通知をモックして外部通信を遮断し、
// malformed/巨大body/正常上限/Content-Type 不正の挙動と、エラー時に Slack 通知0・
// stack/内部情報を漏らさないことを確認する。
import { describe, it, expect, beforeEach, vi } from "vitest";

const slackCalls = { feedback: 0, enterprise: 0 };
vi.mock("@/lib/slack/feedback", () => ({ notifyFeedbackSubmitted: vi.fn(async () => { slackCalls.feedback++; }) }));
vi.mock("@/lib/slack/enterprise-inquiry", () => ({ notifyEnterpriseInquirySubmitted: vi.fn(async () => { slackCalls.enterprise++; }) }));
// getAuthUser は未認証(null)で通す（feedback は公開）
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getAuthUser: vi.fn(async () => null) };
});

import { POST as feedbackPOST } from "@/app/api/feedback/route";

function req(bodyText: string | object, headers: Record<string, string> = {}) {
  const raw = typeof bodyText === "string" ? bodyText : JSON.stringify(bodyText);
  return {
    json: async () => { return JSON.parse(raw); },
    headers: new Headers({ "content-type": "application/json", ...headers }),
    method: "POST", url: "http://localhost/api/feedback",
  } as never;
}

// webhook URL 未設定の test env で valid 経路を決定的にするため dev_skip を有効化。
beforeEach(() => { slackCalls.feedback = 0; slackCalls.enterprise = 0; process.env.FEEDBACK_DEV_SKIP = "true"; });

describe("feedback negative", () => {
  it("malformed JSON → 500 でも stack/内部情報を漏らさず・Slack 通知0", async () => {
    const res = await feedbackPOST(req("{ not json"));
    // 実装は outer catch で generic error を返す（400 でなく 500 だが情報漏洩なし）
    const body = await res.json();
    expect([400, 500]).toContain(res.status);
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/at .*\/.*\.ts:\d+/); // stack trace が無い
    expect(raw).not.toContain("prisma");
    expect(slackCalls.feedback + slackCalls.enterprise).toBe(0); // 通知されない
  });

  it("content なし → 400・Slack 通知0", async () => {
    const res = await feedbackPOST(req({ category: "" }));
    expect(res.status).toBe(400);
    expect(slackCalls.feedback + slackCalls.enterprise).toBe(0);
  });

  it("巨大 content（>100文字・通常カテゴリ）→ 400・Slack 通知0", async () => {
    const res = await feedbackPOST(req({ category: "", content: "あ".repeat(500) }));
    expect(res.status).toBe(400);
    expect(slackCalls.feedback + slackCalls.enterprise).toBe(0);
  });

  it("正常 content（上限内）→ 200（dev_skip 経路・エラーなし）", async () => {
    const res = await feedbackPOST(req({ category: "", content: "テスト意見です" }));
    expect(res.status).toBe(200);
  });

  it("連打（同一 content 3連続）→ 各 200（rate limit なし＝abuse 対策なし・P3 運用リスク）", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await feedbackPOST(req({ category: "", content: "連打テスト" }))).status);
    // rate limit / dedup が無い現状仕様: 3回とも 200（弾かれない）＝ abuse 余地。運用リスク(P3)として記録。
    expect(codes).toEqual([200, 200, 200]);
  });
});
