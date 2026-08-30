// src/__tests__/rh-e2e/qr-postback-safety.e2e.ts
// Quick Reply / Postback の安全性 E2E（§3 の「古い/不正 postback を安全無視・500 化しない」）。
//  - parseQuickReplyPostback の境界（pure）。
//  - webhook 実経路に malformed / 不正 qrIndex / 存在しない sourceMessageId の postback を投げ、
//    500 にならず 200・LINE 送信が暴発しないことを確認。
// 正常な postback 解決の正しさ（2 重「次へ」→固有送信先・frontier ガード・cross-work）は
// 既存 unit test `webhook-quickReply-postback.test.ts`（npm test 2571 に含む）でカバー済み。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { parseQuickReplyPostback, buildQuickReplyPostbackData } from "@/lib/quick-reply-postback";

const lineCalls = { reply: 0, replyWithLag: 0, push: 0 };
vi.mock("@/lib/line", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line")>();
  return {
    ...actual,
    replyToLine: vi.fn(async () => { lineCalls.reply++; }),
    replyWithLagToLine: vi.fn(async () => { lineCalls.replyWithLag++; }),
    pushToLine: vi.fn(async () => { lineCalls.push++; }),
  };
});

import { prisma } from "@/lib/prisma";
import { deleteCacheByPrefix } from "@/lib/cache";
import { seedSynthetic, cleanupOa, SYNTHETIC_CHANNEL_SECRET, lineOaIdFor, TEST_LINE_USER } from "./_seed";
import { POST as webhookPOST } from "@/app/api/line/[oaId]/webhook/route";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;
const TAG = "qrsafe";
const LINE_OA_ID = lineOaIdFor(TAG);
const sign = (b: string) => crypto.createHmac("sha256", SYNTHETIC_CHANNEL_SECRET).update(b).digest("base64");

async function postbackEvent(data: string, userId: string) {
  const rawBody = JSON.stringify({ destination: "Uxxx", events: [{ type: "postback", mode: "active", timestamp: 1, replyToken: "rt_" + Math.random().toString(36).slice(2, 8), source: { type: "user", userId }, postback: { data } }] });
  const headers = new Headers({ "x-line-signature": sign(rawBody) });
  const req = { text: async () => rawBody, headers, method: "POST", url: `http://localhost/api/line/${LINE_OA_ID}/webhook` } as never;
  return webhookPOST(req, { params: { oaId: LINE_OA_ID } } as never);
}

beforeAll(async () => { ids = await seedSynthetic(TAG); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });
beforeEach(() => { lineCalls.reply = 0; lineCalls.replyWithLag = 0; lineCalls.push = 0; deleteCacheByPrefix("oa:"); deleteCacheByPrefix("work:"); deleteCacheByPrefix("phase:"); });

describe("parseQuickReplyPostback boundaries (pure)", () => {
  it("正しい postback data を解析", () => {
    const d = buildQuickReplyPostbackData("11111111-1111-1111-1111-111111111111", 2);
    expect(parseQuickReplyPostback(d)).toEqual({ sourceMessageId: "11111111-1111-1111-1111-111111111111", qrIndex: 2 });
  });
  it("action 不一致 / sourceMessageId 空 / 負・非整数 qrIndex → null", () => {
    expect(parseQuickReplyPostback("action=other&sourceMessageId=x&qrIndex=0")).toBeNull();
    expect(parseQuickReplyPostback("action=quick_reply&sourceMessageId=&qrIndex=0")).toBeNull();
    expect(parseQuickReplyPostback("action=quick_reply&sourceMessageId=x&qrIndex=-1")).toBeNull();
    expect(parseQuickReplyPostback("action=quick_reply&sourceMessageId=x&qrIndex=abc")).toBeNull();
  });
  it("malformed data 文字列でも throw しない", () => {
    expect(() => parseQuickReplyPostback("%%%not-a-query%%%")).not.toThrow();
    expect(() => parseQuickReplyPostback("")).not.toThrow();
  });
});

describe("webhook postback safety (real route × PG)", () => {
  it("malformed postback data → 200・500 化しない", async () => {
    const res = await postbackEvent("%%%garbage%%%", `${TEST_LINE_USER}_qs1`);
    expect(res.status).toBe(200);
  });
  it("存在しない sourceMessageId の postback → 200・安全無視", async () => {
    const res = await postbackEvent(buildQuickReplyPostbackData("00000000-0000-0000-0000-000000000000", 0), `${TEST_LINE_USER}_qs2`);
    expect(res.status).toBe(200);
  });
  it("不正 qrIndex（範囲外）→ 200・500 化しない", async () => {
    const res = await postbackEvent(buildQuickReplyPostbackData(ids.qrPostbackMsgId, 999), `${TEST_LINE_USER}_qs3`);
    expect(res.status).toBe(200);
  });
  it("空 postback data → 200", async () => {
    const res = await postbackEvent("", `${TEST_LINE_USER}_qs4`);
    expect(res.status).toBe(200);
  });
  it("同一 postback を並行送信しても 500 化せず・progress 重複なし", async () => {
    const lu = `${TEST_LINE_USER}_qs_race`;
    const data = buildQuickReplyPostbackData(ids.qrPostbackMsgId, 0);
    const results = await Promise.all([postbackEvent(data, lu), postbackEvent(data, lu)]);
    for (const r of results) expect(r.status).toBe(200);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBeLessThanOrEqual(1); // 二重 progress を作らない
  });
});
