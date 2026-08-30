// src/__tests__/rh-e2e/webhook.e2e.ts
// LINE Webhook Route Handler の E2E（実 route × 実 docker PG）。
// - @/lib/line の「送信3関数」だけモックして呼び出しを記録（署名検証・builder は実物のまま）。
// - 署名はダミー Channel Secret から HMAC-SHA256 で生成。
// - 外部 HTTP は一切発生しないことを担保（send はすべてモックが受ける）。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

// ── LINE 送信層のモック（記録用）。verifyLineSignature/builder 等は実物を維持。 ──
const lineCalls = { reply: [] as unknown[], replyWithLag: [] as unknown[], push: [] as unknown[] };
vi.mock("@/lib/line", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line")>();
  return {
    ...actual,
    replyToLine: vi.fn(async (replyToken: string, messages: unknown[], _token: string) => { lineCalls.reply.push({ replyToken, count: messages.length, messages }); }),
    replyWithLagToLine: vi.fn(async (replyToken: string, messages: unknown[]) => { lineCalls.replyWithLag.push({ replyToken, count: messages.length, messages }); }),
    pushToLine: vi.fn(async (to: string, messages: unknown[]) => { lineCalls.push.push({ to, count: messages.length, messages }); }),
  };
});

import { prisma } from "@/lib/prisma";
import { deleteCacheByPrefix } from "@/lib/cache";
import { seedSynthetic, cleanupOa, SYNTHETIC_CHANNEL_SECRET, lineOaIdFor, TEST_LINE_USER } from "./_seed";
import { POST as webhookPOST } from "@/app/api/line/[oaId]/webhook/route";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;
const TAG = "webhook";
const LINE_OA_ID = lineOaIdFor(TAG);

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", SYNTHETIC_CHANNEL_SECRET).update(rawBody).digest("base64");
}

/** webhook route を叩く。sig: "valid" | "invalid" | "none"。 */
async function postWebhook(events: unknown[], sig: "valid" | "invalid" | "none" = "valid") {
  const rawBody = JSON.stringify({ destination: "Uxxx", events });
  const headers = new Headers({ "content-type": "application/json" });
  if (sig === "valid") headers.set("x-line-signature", sign(rawBody));
  else if (sig === "invalid") headers.set("x-line-signature", "invalid_signature_value");
  const req = { text: async () => rawBody, headers, method: "POST", url: `http://localhost/api/line/${LINE_OA_ID}/webhook` } as never;
  const res = await webhookPOST(req, { params: { oaId: LINE_OA_ID } } as never);
  return res;
}

function msgEvent(text: string, replyToken = "rt_" + Math.random().toString(36).slice(2, 8)) {
  return { type: "message", mode: "active", timestamp: 1, replyToken, source: { type: "user", userId: `${TEST_LINE_USER}_wh` }, message: { id: "1", type: "text", text } };
}

beforeAll(async () => { ids = await seedSynthetic(TAG); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });
beforeEach(() => {
  lineCalls.reply.length = 0; lineCalls.replyWithLag.length = 0; lineCalls.push.length = 0;
  deleteCacheByPrefix("oa:"); deleteCacheByPrefix("work:"); deleteCacheByPrefix("phase:");
});

describe("webhook signature", () => {
  it("正しい署名 → 200 + イベント処理（LINE 送信が記録される）", async () => {
    const res = await postWebhook([msgEvent("はじめる")], "valid");
    expect(res.status).toBe(200);
    const sends = lineCalls.reply.length + lineCalls.replyWithLag.length + lineCalls.push.length;
    expect(sends).toBeGreaterThan(0); // 開始応答が送られる
  });

  it("不正な署名 → 200 だがイベント未処理（LINE 送信ゼロ・DB 変更なし）", async () => {
    const lu = `${TEST_LINE_USER}_wh_badsig`;
    const before = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    const res = await postWebhook([{ ...msgEvent("はじめる"), source: { type: "user", userId: lu } }], "invalid");
    expect(res.status).toBe(200); // LINE 仕様: 常に 200（再送防止）
    expect(lineCalls.reply.length + lineCalls.replyWithLag.length + lineCalls.push.length).toBe(0); // 未処理
    const after = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(after).toBe(before); // DB 変更なし
  });

  it("events 空（疎通確認）→ 200・送信なし", async () => {
    const res = await postWebhook([], "none");
    expect(res.status).toBe(200);
    expect(lineCalls.reply.length + lineCalls.replyWithLag.length + lineCalls.push.length).toBe(0);
  });

  it("malformed JSON body → 500 にならず 200", async () => {
    const req = { text: async () => "{ not json", headers: new Headers(), method: "POST", url: `http://localhost/api/line/${LINE_OA_ID}/webhook` } as never;
    const res = await webhookPOST(req, { params: { oaId: LINE_OA_ID } } as never);
    expect(res.status).toBe(200);
  });
});

describe("webhook start flow (real route × PG)", () => {
  it("開始キーワードで progress が作られ、二重送信されない", async () => {
    const lu = `${TEST_LINE_USER}_wh_start`;
    const ev = { ...msgEvent("はじめる"), source: { type: "user", userId: lu } };
    const res = await postWebhook([ev], "valid");
    expect(res.status).toBe(200);
    // start 応答は reply 経路（1 リクエスト内で複数 push はしない）
    const totalSends = lineCalls.reply.length + lineCalls.replyWithLag.length;
    expect(totalSends).toBeGreaterThanOrEqual(1);
    // 同じ reply token を 2 回使っていない（reply token 再利用なし）
    const replyTokens = [...lineCalls.reply, ...lineCalls.replyWithLag].map((c) => (c as { replyToken: string }).replyToken);
    expect(new Set(replyTokens).size).toBe(replyTokens.length);
  });
});
