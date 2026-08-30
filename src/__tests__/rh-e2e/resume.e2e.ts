// src/__tests__/rh-e2e/resume.e2e.ts
// Resume（つづきから相当）の progress 整合性 E2E（§5）。実 runtime route × docker PG。
// 各待機状態から progress GET が正しい現在位置を返し、再開操作で progress を重複作成しない・
// completed を誤って初期化しない・並行 resume で二重更新/重複行を作らないことを確認。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  withAuth: (h: (req: unknown, ctx: unknown, u: { id: string }) => unknown) => (req: unknown, ctx: unknown) => h(req, ctx, { id: "rh-test-user-0001" }),
}));

import { prisma } from "@/lib/prisma";
import { seedSynthetic, cleanupOa, TEST_LINE_USER } from "./_seed";
import { GET as progressGET } from "@/app/api/runtime/progress/route";
import { POST as startPOST } from "@/app/api/runtime/start/route";
import { POST as advancePOST } from "@/app/api/runtime/advance/route";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;
const jreq = (b: unknown) => ({ json: async () => b, headers: new Headers(), method: "POST", url: "http://localhost/api" } as never);
const greq = (qs: Record<string, string>) => { const u = new URL("http://localhost/api/runtime/progress"); for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v); return { url: u.toString(), headers: new Headers(), method: "GET" } as never; };

beforeAll(async () => { ids = await seedSynthetic("resume"); });
afterAll(async () => { await cleanupOa(ids.oaId); await prisma.$disconnect(); });

/** 特定状態の progress を用意する。 */
async function setProgress(lu: string, data: Partial<{ currentPhaseId: string | null; reachedEnding: boolean; waitingForInput: string | null; lastSentMessageIds: string | null; flags: string }>) {
  return prisma.userProgress.upsert({
    where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } },
    create: { lineUserId: lu, workId: ids.workId, currentPhaseId: data.currentPhaseId ?? null, reachedEnding: data.reachedEnding ?? false, waitingForInput: data.waitingForInput ?? null, lastSentMessageIds: data.lastSentMessageIds ?? null, flags: data.flags ?? "{}" },
    update: { currentPhaseId: data.currentPhaseId ?? null, reachedEnding: data.reachedEnding ?? false, waitingForInput: data.waitingForInput ?? null, lastSentMessageIds: data.lastSentMessageIds ?? null, flags: data.flags ?? "{}" },
  });
}

describe("resume: progress GET が正しい現在位置を返す", () => {
  it("phase途中 → currentPhaseId 維持", async () => {
    const lu = `${TEST_LINE_USER}_r_mid`;
    await setProgress(lu, { currentPhaseId: ids.normalPhaseId });
    const res = await progressGET(greq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    expect(res.status).toBe(200);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.currentPhaseId).toBe(ids.normalPhaseId);
  });

  it("free input 待ち → waitingForInput 維持（GET で状態が壊れない）", async () => {
    const lu = `${TEST_LINE_USER}_r_freein`;
    const wfi = JSON.stringify({ messageId: ids.freeInputMsgId, variableKey: "userName" });
    await setProgress(lu, { currentPhaseId: ids.normalPhaseId, waitingForInput: wfi });
    await progressGET(greq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.waitingForInput).toBe(wfi); // 読み取りで待機状態が消えない
  });

  it("frontier(last_sent_message_ids) を持つ状態 → GET で維持", async () => {
    const lu = `${TEST_LINE_USER}_r_frontier`;
    const frontier = JSON.stringify([ids.qrPostbackMsgId]);
    await setProgress(lu, { currentPhaseId: ids.normalPhaseId, lastSentMessageIds: frontier });
    await progressGET(greq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.lastSentMessageIds).toBe(frontier);
  });

  it("progress が無い（未開始）→ GET は 404 相当 or 空（500 化しない）", async () => {
    const res = await progressGET(greq({ line_user_id: `${TEST_LINE_USER}_r_none`, work_id: ids.workId }), {} as never);
    expect([200, 404]).toContain(res.status);
  });
});

describe("resume: completed / 重複防止", () => {
  it("completed(ending到達) 状態 → GET しても reachedEnding が維持（誤って初期化しない）", async () => {
    const lu = `${TEST_LINE_USER}_r_done`;
    await setProgress(lu, { currentPhaseId: ids.endingPhaseId, reachedEnding: true });
    await progressGET(greq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const row = await prisma.userProgress.findUnique({ where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } } });
    expect(row?.reachedEnding).toBe(true);
    expect(row?.currentPhaseId).toBe(ids.endingPhaseId);
  });

  it("phase途中で start(再開) を呼んでも progress 行は 1（重複作成なし）", async () => {
    const lu = `${TEST_LINE_USER}_r_restart`;
    await setProgress(lu, { currentPhaseId: ids.normalPhaseId });
    await startPOST(jreq({ line_user_id: lu, work_id: ids.workId }), {} as never);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBe(1);
  });

  it("並行 resume(start) → progress 行は 1・二重更新で壊れない", async () => {
    const lu = `${TEST_LINE_USER}_r_race`;
    await setProgress(lu, { currentPhaseId: ids.normalPhaseId });
    await Promise.all([
      startPOST(jreq({ line_user_id: lu, work_id: ids.workId }), {} as never).catch(() => null),
      startPOST(jreq({ line_user_id: lu, work_id: ids.workId }), {} as never).catch(() => null),
      advancePOST(jreq({ line_user_id: lu, work_id: ids.workId, target_phase_id: ids.normalPhaseId }), {} as never).catch(() => null),
    ]);
    const cnt = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(cnt).toBe(1);
  });
});
