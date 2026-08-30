// src/__tests__/rh-e2e/runtime-lifecycle.e2e.ts
// 実 Route Handler（/api/runtime/*）× 実 docker PG の E2E。
// LINE 送信は無いルート（runtime API は state を返すのみ）。withAuth のみモックして user 注入。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// withAuth を「user を注入して handler を呼ぶ」だけのパススルーにする（認証は本 E2E の対象外）。
vi.mock("@/lib/auth", () => ({
  withAuth: (handler: (req: unknown, ctx: unknown, user: { id: string }) => unknown) =>
    (req: unknown, ctx: unknown) => handler(req, ctx, { id: "rh-test-user-0001" }),
}));

import { prisma } from "@/lib/prisma";
import { seedSynthetic, cleanupOa, TEST_LINE_USER } from "./_seed";
import { POST as startPOST } from "@/app/api/runtime/start/route";
import { POST as advancePOST } from "@/app/api/runtime/advance/route";
import { GET as progressGET } from "@/app/api/runtime/progress/route";
import { POST as resetPOST } from "@/app/api/runtime/reset/route";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;

function jsonReq(body: unknown) {
  return { json: async () => body, headers: new Headers(), method: "POST", url: "http://localhost/api" } as never;
}
function getReq(qs: Record<string, string>) {
  const u = new URL("http://localhost/api/runtime/progress");
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  return { url: u.toString(), headers: new Headers(), method: "GET" } as never;
}

beforeAll(async () => { ids = await seedSynthetic("lifecycle"); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });

describe("runtime start", () => {
  it("start は progress を currentPhaseId=null で初期化する", async () => {
    const lu = `${TEST_LINE_USER}_start`;
    const res = await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    expect(res.status).toBe(200);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row).not.toBeNull();
    expect(row?.currentPhaseId).toBeNull();
    expect(row?.reachedEnding).toBe(false);
  });

  it("start を 2 回呼んでも progress は 1 行（二重開始で行が増えない）", async () => {
    const lu = `${TEST_LINE_USER}_start2`;
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBe(1);
  });
});

describe("runtime advance (phase transition)", () => {
  it("label 一致で start→normal phase へ遷移する", async () => {
    const lu = `${TEST_LINE_USER}_adv`;
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    // まず start phase へ入る（target_phase_id 指定）
    await advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, target_phase_id: ids.startPhaseId }), {} as never);
    // 「進む」ラベルで normal へ
    const res = await advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, label: "進む" }), {} as never);
    expect(res.status).toBe(200);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.currentPhaseId).toBe(ids.normalPhaseId);
  });

  it("一致しない label では遷移しない（現フェーズ維持）", async () => {
    const lu = `${TEST_LINE_USER}_adv_nomatch`;
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    await advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, target_phase_id: ids.startPhaseId }), {} as never);
    await advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, label: "存在しないラベル" }), {} as never);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.currentPhaseId).toBe(ids.startPhaseId); // 遷移していない
  });

  it("同一 label の並行 advance で二重遷移しない（最終位置は normal 1 つ）", async () => {
    const lu = `${TEST_LINE_USER}_adv_race`;
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    await advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, target_phase_id: ids.startPhaseId }), {} as never);
    await Promise.all([
      advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, label: "進む" }), {} as never).catch(() => null),
      advancePOST(jsonReq({ line_user_id: lu, work_id: ids.workId, label: "進む" }), {} as never).catch(() => null),
    ]);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBe(1);
    expect(row?.currentPhaseId).toBe(ids.normalPhaseId);
  });
});

describe("runtime progress / reset", () => {
  it("progress GET は現在状態を返す", async () => {
    const lu = `${TEST_LINE_USER}_prog`;
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const res = await progressGET(getReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    expect(res.status).toBe(200);
  });

  it("reset は progress を削除する", async () => {
    const lu = `${TEST_LINE_USER}_reset`;
    await startPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    await resetPOST(jsonReq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBe(0);
  });
});
