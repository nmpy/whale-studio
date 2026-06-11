/**
 * src/__tests__/frontier-effect.test.ts
 *
 * applyFreeInputPostEffect（送信後の frontier / waitingForInput 更新）の単体テスト。
 *
 * これは puzzle 正解遷移バグ修正（#243 frontier 更新漏れ）の中核メカニズム。
 * handlePuzzleCorrect は遷移成功時にこの関数へ「新 phase の送信 message ids」を渡すことで
 * frontier を現在地へ更新する（route.ts は Next.js の制約で関数 export 不可のため、
 * frontier 更新ロジックを本 lib に切り出し直接検証する。handlePuzzleCorrect 側の呼び出しは
 * QR target_phase 経路と同型・1行で、実機確認で end-to-end を担保する）。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

const mockPrisma = {
  userProgress: { update: vi.fn(), upsert: vi.fn() },
  message:      { findFirst: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockCache = { delete: vi.fn(async () => {}) };
vi.mock("@/lib/cache", () => ({
  activeCache: mockCache,
  CACHE_KEY: { progress: (u: string, w: string) => `progress:${u}:${w}` },
}));

// 動的 import（vi.mock ホイスト前に mockPrisma を参照しないため）
let applyFreeInputPostEffect: typeof import("@/lib/frontier-effect").applyFreeInputPostEffect;
beforeAll(async () => {
  ({ applyFreeInputPostEffect } = await import("@/lib/frontier-effect"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.message.findFirst.mockResolvedValue(null);
  mockPrisma.userProgress.update.mockResolvedValue({});
  mockPrisma.userProgress.upsert.mockResolvedValue({});
});

describe("applyFreeInputPostEffect", () => {
  it("sentMessageIds を frontier(lastSentMessageIds) として progressId で update する", async () => {
    await applyFreeInputPostEffect({ sentMessageIds: ["b1", "b2"], userId: "u", workId: "w", progressId: "p", route: "puzzle_correct_phase" });
    expect(mockPrisma.userProgress.update).toHaveBeenCalledWith({
      where: { id: "p" },
      data:  { lastSentMessageIds: JSON.stringify(["b1", "b2"]) },
    });
    expect(mockCache.delete).toHaveBeenCalledWith("progress:u:w");
  });

  it("frontier は渡された ids そのまま（新 phase の ids なら新 phase に更新される）", async () => {
    // puzzle 正解で新 phase B の message ids を渡すケース
    await applyFreeInputPostEffect({ sentMessageIds: ["B-head", "B-tail-with-qr"], userId: "u", workId: "w", progressId: "p" });
    const data = mockPrisma.userProgress.update.mock.calls[0][0].data;
    const ids = JSON.parse(data.lastSentMessageIds);
    expect(ids).toEqual(["B-head", "B-tail-with-qr"]);
    expect(ids).toContain("B-tail-with-qr"); // 新 phase 末尾の QR 担当 message → frontier スコープ内になる
  });

  it("sentMessageIds が空なら no-op（update/upsert しない）", async () => {
    await applyFreeInputPostEffect({ sentMessageIds: [], userId: "u", workId: "w", progressId: "p" });
    expect(mockPrisma.userProgress.update).not.toHaveBeenCalled();
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("送信群に freeInput プロンプトがあれば waitingForInput も立てる", async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ id: "b2", freeInputVariableKey: "freeText", freeInputNextMessageId: "r" });
    await applyFreeInputPostEffect({ sentMessageIds: ["b1", "b2"], userId: "u", workId: "w", progressId: "p" });
    const data = mockPrisma.userProgress.update.mock.calls[0][0].data;
    expect(data.lastSentMessageIds).toBe(JSON.stringify(["b1", "b2"]));
    expect(data.waitingForInput).toBeTruthy();
    expect(JSON.parse(data.waitingForInput)).toMatchObject({ messageId: "b2", variableKey: "freeText", nextMessageId: "r" });
  });

  it("freeInput が無ければ waitingForInput は更新しない（既存値を保持）", async () => {
    await applyFreeInputPostEffect({ sentMessageIds: ["b1", "b2"], userId: "u", workId: "w", progressId: "p" });
    const data = mockPrisma.userProgress.update.mock.calls[0][0].data;
    expect(data.waitingForInput).toBeUndefined();
  });

  it("progressId 無しなら upsert で frontier を保存する（開始直後）", async () => {
    await applyFreeInputPostEffect({ sentMessageIds: ["b1"], userId: "u", workId: "w" });
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where:  { lineUserId_workId: { lineUserId: "u", workId: "w" } },
      update: { lastSentMessageIds: JSON.stringify(["b1"]) },
    }));
  });
});
