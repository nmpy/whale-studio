// src/__tests__/rh-e2e/response-puzzle-hint.e2e.ts
// Response Puzzle / Hint の webhook 実経路 × docker PG での「不変条件」E2E（§2/§3）。
// 表示・index 等の詳細ロジックは既存 unit/integration（webhook-hint-quickReply / puzzle-hint /
// hint-qr / hint-back-to-puzzle / buildKeywordMessages-hint / buildPhaseMessages-puzzle）が 2571 で担保。
// ここでは実 webhook×実 PG でのみ確認できる不変条件（非answer誤判定・非遷移・二重なし・500なし）を検証。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

const line = { reply: [] as unknown[], replyWithLag: [] as unknown[], push: [] as unknown[] };
vi.mock("@/lib/line", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line")>();
  return {
    ...actual,
    replyToLine: vi.fn(async (t: string, m: unknown[]) => { line.reply.push({ t, n: m.length }); }),
    replyWithLagToLine: vi.fn(async (t: string, m: unknown[]) => { line.replyWithLag.push({ t, n: m.length }); }),
    pushToLine: vi.fn(async (to: string, m: unknown[]) => { line.push.push({ to, n: m.length }); }),
  };
});

import { prisma } from "@/lib/prisma";
import { deleteCacheByPrefix } from "@/lib/cache";
import { seedSynthetic, cleanupOa, SYNTHETIC_CHANNEL_SECRET, lineOaIdFor, TEST_LINE_USER } from "./_seed";
import { POST as webhookPOST } from "@/app/api/line/[oaId]/webhook/route";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;
const TAG = "resppz";
const LINE_OA_ID = lineOaIdFor(TAG);
const sign = (b: string) => crypto.createHmac("sha256", SYNTHETIC_CHANNEL_SECRET).update(b).digest("base64");

async function sendText(text: string, userId: string) {
  const rawBody = JSON.stringify({ destination: "Uxxx", events: [{ type: "message", mode: "active", timestamp: 1, replyToken: "rt_" + Math.random().toString(36).slice(2, 8), source: { type: "user", userId }, message: { id: "1", type: "text", text } }] });
  const req = { text: async () => rawBody, headers: new Headers({ "x-line-signature": sign(rawBody) }), method: "POST", url: `http://localhost/api/line/${LINE_OA_ID}/webhook` } as never;
  return webhookPOST(req, { params: { oaId: LINE_OA_ID } } as never);
}
async function placeNormal(lu: string) {
  await prisma.userProgress.upsert({
    where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } },
    create: { lineUserId: lu, workId: ids.workId, currentPhaseId: ids.normalPhaseId, reachedEnding: false, flags: "{}" },
    update: { currentPhaseId: ids.normalPhaseId, reachedEnding: false, flags: "{}" },
  });
}
const solved = async (lu: string) => JSON.parse((await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } }))?.flags ?? "{}").solvedPuzzles ?? [];
const phaseOf = async (lu: string) => (await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } }))?.currentPhaseId;

beforeAll(async () => { ids = await seedSynthetic(TAG); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });
beforeEach(() => { line.reply.length = 0; line.replyWithLag.length = 0; line.push.length = 0; deleteCacheByPrefix("oa:"); deleteCacheByPrefix("work:"); deleteCacheByPrefix("phase:"); });

describe("response-keyword / hint 不変条件（webhook × PG）", () => {
  it("応答キーワード『あいことば』→ 200・phase 遷移せず・puzzle solved にならない", async () => {
    const lu = `${TEST_LINE_USER}_rp_kw`;
    await placeNormal(lu);
    const res = await sendText("あいことば", lu);
    expect(res.status).toBe(200);
    expect(await phaseOf(lu)).toBe(ids.normalPhaseId); // 応答キーワードで遷移しない
    expect(await solved(lu)).not.toContain(ids.puzzleExactMsgId); // answer 誤判定なし
  });

  it("ヒントキーワード『ヒント』→ 200・phase 遷移せず・solved にならない", async () => {
    const lu = `${TEST_LINE_USER}_rp_hint`;
    await placeNormal(lu);
    const res = await sendText("ヒント", lu);
    expect(res.status).toBe(200);
    expect(await phaseOf(lu)).toBe(ids.normalPhaseId); // hint で遷移しない
    expect(await solved(lu)).not.toContain(ids.puzzleExactMsgId);
  });

  it("非マッチ入力 → 200・遷移せず・500 にならない", async () => {
    const lu = `${TEST_LINE_USER}_rp_nomatch`;
    await placeNormal(lu);
    const res = await sendText("まったく無関係な入力xyz", lu);
    expect(res.status).toBe(200);
    expect(await phaseOf(lu)).toBe(ids.normalPhaseId);
  });

  it("puzzle 正解『さくら』→ solved 記録 + ending 遷移（正解時のみ後続進行）", async () => {
    const lu = `${TEST_LINE_USER}_rp_correct`;
    await placeNormal(lu);
    const res = await sendText("さくら", lu);
    expect(res.status).toBe(200);
    expect(await solved(lu)).toContain(ids.puzzleExactMsgId);
    expect(await phaseOf(lu)).toBe(ids.endingPhaseId);
  });

  it("不正解入力 → solved にならず・遷移しない（answer 待ち維持）", async () => {
    const lu = `${TEST_LINE_USER}_rp_wrong`;
    await placeNormal(lu);
    const res = await sendText("ぜんぜんちがう", lu);
    expect(res.status).toBe(200);
    expect(await solved(lu)).not.toContain(ids.puzzleExactMsgId);
    expect(await phaseOf(lu)).toBe(ids.normalPhaseId);
  });
});

describe("並行処理（response-keyword / hint / 正解）", () => {
  it("同一 hint keyword を並行 → 200・progress 1行・遷移なし・二重化しても DB 破損なし", async () => {
    const lu = `${TEST_LINE_USER}_rp_hint_race`;
    await placeNormal(lu);
    const rs = await Promise.all([sendText("ヒント", lu), sendText("ヒント", lu)]);
    for (const r of rs) expect(r.status).toBe(200);
    expect(await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } })).toBe(1);
    expect(await phaseOf(lu)).toBe(ids.normalPhaseId);
  });

  it("同一 puzzle 正解を並行 → phase 二重遷移なし（最終 ending・progress 1行）", async () => {
    const lu = `${TEST_LINE_USER}_rp_correct_race`;
    await placeNormal(lu);
    await Promise.all([sendText("さくら", lu).catch(() => null), sendText("さくら", lu).catch(() => null)]);
    expect(await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } })).toBe(1);
    expect(await phaseOf(lu)).toBe(ids.endingPhaseId);
  });

  it("正解後に再度 answer 再送 → completed 状態が壊れない（reachedEnding 維持）", async () => {
    const lu = `${TEST_LINE_USER}_rp_resend`;
    await placeNormal(lu);
    await sendText("さくら", lu);
    await sendText("さくら", lu); // 再送
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.reachedEnding).toBe(true);
  });
});
