// src/__tests__/rh-e2e/free-text-start.e2e.ts
// free_text 開始（startTriggerMode="free_text"）の E2E（§4）。
//  (A) 解決 pure 関数 resolveFreeTextStartWork の判定（start/ambiguous/none）。
//  (B) webhook 実経路で「完全新規ユーザーの任意入力 → 作品開始」、初回入力が
//      response keyword / puzzle answer として誤消費されない、二重 progress を作らない。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { resolveFreeTextStartWork } from "@/lib/start-keyword";

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
import { seedFreeText, cleanupOa, SYNTHETIC_CHANNEL_SECRET, lineOaIdFor, TEST_LINE_USER } from "./_seed";
import { POST as webhookPOST } from "@/app/api/line/[oaId]/webhook/route";

let ids: Awaited<ReturnType<typeof seedFreeText>>;
const TAG = "freetext";
const LINE_OA_ID = lineOaIdFor(TAG);
const sign = (b: string) => crypto.createHmac("sha256", SYNTHETIC_CHANNEL_SECRET).update(b).digest("base64");

async function textEvent(text: string, userId: string) {
  const rawBody = JSON.stringify({ destination: "Uxxx", events: [{ type: "message", mode: "active", timestamp: 1, replyToken: "rt_" + Math.random().toString(36).slice(2, 8), source: { type: "user", userId }, message: { id: "1", type: "text", text } }] });
  const headers = new Headers({ "x-line-signature": sign(rawBody) });
  const req = { text: async () => rawBody, headers, method: "POST", url: `http://localhost/api/line/${LINE_OA_ID}/webhook` } as never;
  return webhookPOST(req, { params: { oaId: LINE_OA_ID } } as never);
}

beforeAll(async () => { ids = await seedFreeText(TAG); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });
beforeEach(() => { lineCalls.reply = 0; lineCalls.replyWithLag = 0; lineCalls.push = 0; deleteCacheByPrefix("oa:"); deleteCacheByPrefix("work:"); deleteCacheByPrefix("phase:"); });

// ── (A) resolve pure ──
describe("resolveFreeTextStartWork (pure)", () => {
  it("free_text 作品ちょうど1件 → start", () => {
    const r = resolveFreeTextStartWork([{ id: "w1", startTriggerMode: "free_text" }, { id: "w2", startTriggerMode: "keyword" }]);
    expect(r.status).toBe("start");
    if (r.status === "start") expect(r.workId).toBe("w1");
  });
  it("free_text 作品が複数 → ambiguous（開始しない）", () => {
    const r = resolveFreeTextStartWork([{ id: "w1", startTriggerMode: "free_text" }, { id: "w2", startTriggerMode: "free_text" }]);
    expect(r.status).toBe("ambiguous");
  });
  it("free_text 作品なし → none", () => {
    const r = resolveFreeTextStartWork([{ id: "w1", startTriggerMode: "keyword" }]);
    expect(r.status).toBe("none");
  });
});

// ── (B) webhook 実経路 ──
describe("free_text start via webhook (real route × PG)", () => {
  it("完全新規ユーザーの任意入力 → 作品開始（progress 作成・start 応答送信）", async () => {
    const lu = `${TEST_LINE_USER}_ft_new`;
    const res = await textEvent("なんでもいい入力", lu);
    expect(res.status).toBe(200);
    const prog = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(prog).not.toBeNull(); // 開始された
    expect(lineCalls.reply + lineCalls.replyWithLag).toBeGreaterThan(0); // 開始メッセージ送信
  });

  it("初回入力が response keyword『こんにちは』と一致していても、開始として扱い応答/正解として誤消費しない", async () => {
    const lu = `${TEST_LINE_USER}_ft_kw`;
    // response/puzzle の triggerKeyword/answer は「こんにちは」。初回入力にそれを送っても
    // free_text 新規開始が優先され、response送信や puzzle solved は起きない。
    const res = await textEvent("こんにちは", lu);
    expect(res.status).toBe(200);
    const prog = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(prog).not.toBeNull();
    // puzzle が solved になっていない（初回入力は answer 判定されない）
    const flags = JSON.parse(prog?.flags ?? "{}");
    expect(flags.solvedPuzzles ?? []).not.toContain(ids.puzzleMsgId);
  });

  it("既存 progress ユーザーには free_text 開始を再適用しない（progress 重複なし）", async () => {
    const lu = `${TEST_LINE_USER}_ft_existing`;
    await textEvent("初回", lu); // 開始
    const cnt1 = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    await textEvent("2回目の任意入力", lu); // 再開始されない
    const cnt2 = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt1).toBe(1);
    expect(cnt2).toBe(1); // 重複しない
  });

  it("同じ初回入力を並行送信しても progress は 1 行（二重開始なし）", async () => {
    const lu = `${TEST_LINE_USER}_ft_race`;
    await Promise.all([textEvent("同時", lu), textEvent("同時", lu)]);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBe(1);
  });
});
