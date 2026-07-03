// src/__tests__/auto-transition-post-effect.test.ts
//
// 新機能: メッセージ送信後の silent auto-transition。
// applyFreeInputPostEffect（送信後 post-effect）で、送信済みメッセージに autoTransitionPhaseId が
// あれば、プレイヤーの入力を待たず currentPhaseId のみ更新する（遷移先の入場メッセージは送らない＝silent）。
//
// Case 1: 送信後に currentPhaseId が自動更新される
// Case 2: silent（この関数は buildPhaseMessages を一切呼ばない = 入場メッセージも「続きを選んでください。」も送らない）
// scope: 遷移先 phase が別 work なら更新しない
// ending: 遷移先が ending なら reachedEnding=true
// none:   autoTransitionPhaseId を持つメッセージが無ければ currentPhaseId は更新しない
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, armCheckin, armSched } = vi.hoisted(() => ({
  mockPrisma: {
    message:      { findFirst: vi.fn() },
    phase:        { findUnique: vi.fn() },
    userProgress: { update: vi.fn(), upsert: vi.fn() },
  },
  armCheckin: vi.fn(),
  armSched:   vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/cache", () => ({
  activeCache: { delete: vi.fn().mockResolvedValue(undefined) },
  CACHE_KEY:   { progress: (u: string, w: string) => `progress:${u}:${w}` },
}));
vi.mock("@/lib/checkin-trigger", () => ({ armCheckinTriggers: armCheckin }));
vi.mock("@/lib/scheduled-message-arm", () => ({ armScheduledMessages: armSched }));

import { applyFreeInputPostEffect } from "@/lib/frontier-effect";

// message.findFirst は free_input 用と auto-transition 用の2回呼ばれる。where で振り分ける。
function setupFindFirst(opts: { freeInput?: unknown; autoTrans?: unknown }) {
  mockPrisma.message.findFirst.mockImplementation((args: { where?: Record<string, unknown> }) => {
    const w = args?.where ?? {};
    if ("freeInputEnabled" in w) return Promise.resolve(opts.freeInput ?? null);
    if ("autoTransitionPhaseId" in w) return Promise.resolve(opts.autoTrans ?? null);
    return Promise.resolve(null);
  });
}
const lastUpdateData = () => mockPrisma.userProgress.update.mock.calls.at(-1)?.[0]?.data ?? {};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.userProgress.update.mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const base = { sentMessageIds: ["m1"], userId: "U1", workId: "work-1", progressId: "p1", oaId: "oa-1", route: "keyword" };

describe("silent auto-transition (applyFreeInputPostEffect)", () => {
  it("Case 1: 送信メッセージに autoTransitionPhaseId → currentPhaseId が自動更新される（入力不要）", async () => {
    setupFindFirst({ autoTrans: { id: "m1", autoTransitionPhaseId: "phaseB" } });
    mockPrisma.phase.findUnique.mockResolvedValue({ id: "phaseB", workId: "work-1", phaseType: "normal" });

    await applyFreeInputPostEffect(base);

    expect(mockPrisma.userProgress.update).toHaveBeenCalledTimes(1);
    const data = lastUpdateData();
    expect(data.currentPhaseId).toBe("phaseB");
    expect(data.reachedEnding).toBe(false);
    // frontier も更新される
    expect(typeof data.lastSentMessageIds).toBe("string");
  });

  it("Case 2: silent — 遷移先フェーズの送信は行わない（buildPhaseMessages を import しておらず、currentPhaseId のみ更新）", async () => {
    setupFindFirst({ autoTrans: { id: "m1", autoTransitionPhaseId: "phaseB" } });
    mockPrisma.phase.findUnique.mockResolvedValue({ id: "phaseB", workId: "work-1", phaseType: "normal" });

    await applyFreeInputPostEffect(base);

    const data = lastUpdateData();
    // 更新は currentPhaseId / reachedEnding / lastSentMessageIds のみ（送信系の副作用なし）
    expect(data.currentPhaseId).toBe("phaseB");
    expect(Object.keys(data).sort()).toEqual(["currentPhaseId", "lastSentMessageIds", "reachedEnding"]);
  });

  it("scope: 遷移先 phase が別 work なら currentPhaseId を更新しない（frontier のみ）", async () => {
    setupFindFirst({ autoTrans: { id: "m1", autoTransitionPhaseId: "phaseX" } });
    mockPrisma.phase.findUnique.mockResolvedValue({ id: "phaseX", workId: "OTHER-work", phaseType: "normal" });

    await applyFreeInputPostEffect(base);

    const data = lastUpdateData();
    expect(data.currentPhaseId).toBeUndefined();
    expect(data.lastSentMessageIds).toBeDefined();
  });

  it("ending: 遷移先が ending phase なら reachedEnding=true", async () => {
    setupFindFirst({ autoTrans: { id: "m1", autoTransitionPhaseId: "endPhase" } });
    mockPrisma.phase.findUnique.mockResolvedValue({ id: "endPhase", workId: "work-1", phaseType: "ending" });

    await applyFreeInputPostEffect(base);

    const data = lastUpdateData();
    expect(data.currentPhaseId).toBe("endPhase");
    expect(data.reachedEnding).toBe(true);
  });

  it("none: autoTransitionPhaseId を持つメッセージが無ければ currentPhaseId は更新しない（既存挙動）", async () => {
    setupFindFirst({ autoTrans: null });

    await applyFreeInputPostEffect(base);

    const data = lastUpdateData();
    expect(data.currentPhaseId).toBeUndefined();
    expect(data.lastSentMessageIds).toBeDefined();
    // phase 参照も走らない
    expect(mockPrisma.phase.findUnique).not.toHaveBeenCalled();
  });

  it("既存挙動: sentMessageIds が空なら no-op（update は呼ばれない）", async () => {
    await applyFreeInputPostEffect({ ...base, sentMessageIds: [] });
    expect(mockPrisma.userProgress.update).not.toHaveBeenCalled();
  });
});
