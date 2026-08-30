// src/__tests__/rh-e2e/puzzle.e2e.ts
// Puzzle 判定の E2E。
//  (A) 実 advance ルート（webhook と同一の puzzle 判定ロジック）× 実 docker PG での wiring 検証。
//  (B) 共有中核 judgePuzzleAnswer の境界マトリクス（仕様の明示的境界を網羅）。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  withAuth: (handler: (req: unknown, ctx: unknown, user: { id: string }) => unknown) =>
    (req: unknown, ctx: unknown) => handler(req, ctx, { id: "rh-test-user-0001" }),
}));

import { prisma } from "@/lib/prisma";
import { deleteCacheByPrefix } from "@/lib/cache";
import { judgePuzzleAnswer } from "@/lib/puzzle-answer";
import { seedSynthetic, cleanupOa, TEST_LINE_USER } from "./_seed";
import { POST as advancePOST } from "@/app/api/runtime/advance/route";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;
const req = (body: unknown) => ({ json: async () => body, headers: new Headers(), method: "POST", url: "http://localhost/api" } as never);

beforeAll(async () => { ids = await seedSynthetic("puzzle"); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });
beforeEach(() => { deleteCacheByPrefix("phase:"); deleteCacheByPrefix("work:"); deleteCacheByPrefix("oa:"); });

/** player を normal phase（puzzle のあるフェーズ）に配置する。 */
async function placeInNormal(lu: string) {
  await prisma.userProgress.upsert({
    where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } },
    create: { lineUserId: lu, workId: ids.workId, currentPhaseId: ids.normalPhaseId, reachedEnding: false, flags: "{}" },
    update: { currentPhaseId: ids.normalPhaseId, reachedEnding: false, flags: "{}" },
  });
}

// ── (A) advance ルート経由の puzzle wiring ──
describe("puzzle via advance route (exact)", () => {
  it("正解「さくら」→ 正解として ending へ遷移 + solvedPuzzles 記録", async () => {
    const lu = `${TEST_LINE_USER}_pz_ok`;
    await placeInNormal(lu);
    const res = await advancePOST(req({ line_user_id: lu, work_id: ids.workId, label: "さくら" }), {} as never);
    expect(res.status).toBe(200);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.currentPhaseId).toBe(ids.endingPhaseId);
    expect(row?.reachedEnding).toBe(true);
    expect(JSON.parse(row?.flags ?? "{}").solvedPuzzles).toContain(ids.puzzleExactMsgId);
  });

  it("不正解「まちがい」→ 遷移しない・solved 記録なし", async () => {
    const lu = `${TEST_LINE_USER}_pz_ng`;
    await placeInNormal(lu);
    await advancePOST(req({ line_user_id: lu, work_id: ids.workId, label: "まちがい" }), {} as never);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.currentPhaseId).toBe(ids.normalPhaseId); // 遷移していない
    expect(JSON.parse(row?.flags ?? "{}").solvedPuzzles ?? []).not.toContain(ids.puzzleExactMsgId);
  });

  it("NFKC/前後空白/大文字小文字を吸収して正解（全角スペース+全角）", async () => {
    const lu = `${TEST_LINE_USER}_pz_norm`;
    await placeInNormal(lu);
    const res = await advancePOST(req({ line_user_id: lu, work_id: ids.workId, label: "　さくら　" }), {} as never);
    expect(res.status).toBe(200);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.currentPhaseId).toBe(ids.endingPhaseId);
  });

  it("並行で同一正解を送っても二重遷移しない（最終 ending・1 行）", async () => {
    const lu = `${TEST_LINE_USER}_pz_race`;
    await placeInNormal(lu);
    await Promise.all([
      advancePOST(req({ line_user_id: lu, work_id: ids.workId, label: "さくら" }), {} as never).catch(() => null),
      advancePOST(req({ line_user_id: lu, work_id: ids.workId, label: "さくら" }), {} as never).catch(() => null),
    ]);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(cnt).toBe(1);
    expect(row?.currentPhaseId).toBe(ids.endingPhaseId);
  });
});

// ── (B) 共有中核 judgePuzzleAnswer の境界マトリクス（webhook/advance 共通の判定関数）──
describe("puzzle partial boundary matrix (judgePuzzleAnswer)", () => {
  const P = (input: string, answer: string) => judgePuzzleAnswer(input, [answer]).accepted;

  it("完全一致は正解 / 包含は正解", () => {
    expect(P("さくら", "さくら")).toBe(true);
    expect(P("答えはさくらです", "さくら")).toBe(true); // inclusion
  });

  it("1〜4文字: 部分一致なし（包含のみ）", () => {
    expect(P("あいうX", "あいうえ")).toBe(false); // 4文字中3連続 → 不可
    expect(P("あいうえ", "あいうえ")).toBe(true);  // 完全一致
    expect(P("Xあいうえ", "あいうえ")).toBe(true);  // 包含
  });

  it("5文字: 4連続=80%→正解 / 3連続=60%→不正解", () => {
    expect(P("あいうえX", "あいうえお")).toBe(true);  // 5中4連続=80%
    expect(P("あいうXX", "あいうえお")).toBe(false); // 5中3連続=60%
  });

  it("7文字: 6連続=85.7%→正解 / 5連続=71.4%→不正解", () => {
    expect(P("あいうえおかX", "あいうえおかき")).toBe(true);  // 7中6連続
    expect(P("あいうえおXX", "あいうえおかき")).toBe(false); // 7中5連続
  });

  it("8文字: 4連続=50%→正解 / 3連続=37.5%→不正解", () => {
    expect(P("あいうえXXXX", "あいうえおかきく")).toBe(true);  // 8中4連続=50%
    expect(P("あいうXXXXX", "あいうえおかきく")).toBe(false); // 8中3連続=37.5%
  });

  it("非連続一致・順序違いは不正解", () => {
    // 「あいうえお」の文字を離して/逆順で持つ入力（連続部分一致は最大3以下）
    expect(P("あXいXうXえXお", "あいうえお")).toBe(false); // 離散
    expect(P("おえういあ", "あいうえお")).toBe(false);      // 逆順
  });

  it("空文字・記号のみは不正解", () => {
    expect(P("", "さくら")).toBe(false);
    expect(P("！！！ ", "さくら")).toBe(false);
    expect(P("さくら", "")).toBe(false); // 候補空
  });
});
