/**
 * src/__tests__/liff-puzzles-api.test.ts
 *
 * 謎・問題 API (/api/liff/works/[workId]/puzzles) の安全性検証:
 * - レスポンスにネタバレ列（answer / correctText / incorrectText / puzzleHintText 等）を含めない
 * - 表示対象は「出題履歴 ∪ 正解済み(flags)」のみ。status は solved / delivered
 * - line_user_id 無し → 空配列200（500にしない）
 * - flags の parse 失敗でも 500 にならず solved は空扱い
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  userProgress:   { findUnique: vi.fn() },
  puzzleDelivery: { findMany: vi.fn() },
  message:        { findMany: vi.fn() },
  phase:          { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/public-id-resolver", () => ({
  findWorkByIdOrPublicId: vi.fn(async () => ({ id: "work-1", title: "W" })),
}));

import { GET } from "@/app/api/liff/works/[workId]/puzzles/route";

function makeReq(lineUserId?: string) {
  const q = lineUserId ? `?line_user_id=${lineUserId}` : "";
  return new Request(`https://x/api/liff/works/wp/puzzles${q}`) as unknown as Parameters<typeof GET>[0];
}
const ctx = { params: Promise.resolve({ workId: "wp" }) };

beforeEach(() => vi.clearAllMocks());

describe("GET puzzles", () => {
  it("ネタバレ列を返さず、status を solved/delivered で返す", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue({ flags: JSON.stringify({ solvedPuzzles: ["m1"] }) });
    mockPrisma.puzzleDelivery.findMany.mockResolvedValue([
      { messageId: "m1", deliveredAt: new Date("2026-01-01") },
      { messageId: "m2", deliveredAt: new Date("2026-01-02") },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([
      { id: "m1", body: "Q1", phaseId: "p1" },
      { id: "m2", body: "Q2", phaseId: "p1" },
    ]);
    mockPrisma.phase.findMany.mockResolvedValue([{ id: "p1", name: "Phase1" }]);

    const res = await GET(makeReq("u1"), ctx);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.puzzles.length).toBe(2);
    for (const p of json.data.puzzles) {
      expect(Object.keys(p).sort()).toEqual(["body", "id", "phase_name", "status"]);
      expect(p).not.toHaveProperty("answer");
      expect(p).not.toHaveProperty("correctText");
      expect(p).not.toHaveProperty("incorrectText");
      expect(p).not.toHaveProperty("puzzleHintText");
    }
    expect(json.data.puzzles.find((x: { id: string }) => x.id === "m1").status).toBe("solved");
    expect(json.data.puzzles.find((x: { id: string }) => x.id === "m2").status).toBe("delivered");
  });

  it("line_user_id 無しは空配列200", async () => {
    const res = await GET(makeReq(), ctx);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.puzzles).toEqual([]);
  });

  it("flags parse 失敗でも 500 にならず solved 空扱い", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue({ flags: "{broken" });
    mockPrisma.puzzleDelivery.findMany.mockResolvedValue([{ messageId: "m1", deliveredAt: new Date() }]);
    mockPrisma.message.findMany.mockResolvedValue([{ id: "m1", body: "Q", phaseId: null }]);
    mockPrisma.phase.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("u1"), ctx);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.puzzles[0].status).toBe("delivered");
    expect(json.data.puzzles[0].phase_name).toBe(null);
  });

  it("puzzle_deliveries が落ちても（pre-migration）solved だけで動く", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue({ flags: JSON.stringify({ solvedPuzzles: ["m9"] }) });
    mockPrisma.puzzleDelivery.findMany.mockRejectedValue(new Error("relation does not exist"));
    mockPrisma.message.findMany.mockResolvedValue([{ id: "m9", body: "Q9", phaseId: null }]);
    mockPrisma.phase.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("u1"), ctx);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.puzzles.map((x: { id: string }) => x.id)).toEqual(["m9"]);
    expect(json.data.puzzles[0].status).toBe("solved");
  });
});
