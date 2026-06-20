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

function makeReq(lineUserId?: string, mode?: string) {
  const params = new URLSearchParams();
  if (lineUserId) params.set("line_user_id", lineUserId);
  if (mode) params.set("mode", mode);
  const q = params.toString();
  return new Request(`https://x/api/liff/works/wp/puzzles${q ? `?${q}` : ""}`) as unknown as Parameters<typeof GET>[0];
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

  // ── PR-PZ2.1: 表示モード（mode=all|delivered|solved） ──
  it("mode 未指定は従来どおり delivered（後方互換）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue({ flags: "{}" });
    mockPrisma.puzzleDelivery.findMany.mockResolvedValue([{ messageId: "m1", deliveredAt: new Date("2026-01-01") }]);
    mockPrisma.message.findMany.mockResolvedValue([{ id: "m1", body: "Q1", phaseId: null, sortOrder: 0 }]);
    mockPrisma.phase.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("u1"), ctx);
    const json = await res.json();
    // delivered モードは出題履歴を参照する。
    expect(mockPrisma.puzzleDelivery.findMany).toHaveBeenCalled();
    expect(json.data.puzzles.map((x: { id: string }) => x.id)).toEqual(["m1"]);
  });

  it("mode=all は line_user_id 無しでも全有効問題を返す（spoiler-safe・delivery不要）", async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      { id: "a1", body: "Q1", phaseId: null, sortOrder: 0 },
      { id: "a2", body: "Q2", phaseId: null, sortOrder: 1 },
    ]);
    mockPrisma.phase.findMany.mockResolvedValue([]);

    const res = await GET(makeReq(undefined, "all"), ctx);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.puzzles.map((x: { id: string }) => x.id)).toEqual(["a1", "a2"]);
    // line_user_id 無し → solved 判定なし → 全て未回答(delivered)。progress/delivery は参照しない。
    expect(json.data.puzzles.every((p: { status: string }) => p.status === "delivered")).toBe(true);
    expect(mockPrisma.userProgress.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.puzzleDelivery.findMany).not.toHaveBeenCalled();
    for (const p of json.data.puzzles) {
      expect(Object.keys(p).sort()).toEqual(["body", "id", "phase_name", "status"]);
    }
  });

  it("mode=all は solved を status に反映（delivery 履歴は参照しない）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue({ flags: JSON.stringify({ solvedPuzzles: ["a2"] }) });
    mockPrisma.message.findMany.mockResolvedValue([
      { id: "a1", body: "Q1", phaseId: null, sortOrder: 0 },
      { id: "a2", body: "Q2", phaseId: null, sortOrder: 1 },
    ]);
    mockPrisma.phase.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("u1", "all"), ctx);
    const json = await res.json();
    expect(json.data.puzzles.find((x: { id: string }) => x.id === "a2").status).toBe("solved");
    expect(json.data.puzzles.find((x: { id: string }) => x.id === "a1").status).toBe("delivered");
    expect(mockPrisma.puzzleDelivery.findMany).not.toHaveBeenCalled();
  });

  it("mode=solved は正解済みのみ返す（delivery 履歴は参照しない）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue({ flags: JSON.stringify({ solvedPuzzles: ["s1"] }) });
    mockPrisma.message.findMany.mockResolvedValue([{ id: "s1", body: "Q", phaseId: null, sortOrder: 0 }]);
    mockPrisma.phase.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("u1", "solved"), ctx);
    const json = await res.json();
    expect(json.data.puzzles.map((x: { id: string }) => x.id)).toEqual(["s1"]);
    expect(json.data.puzzles[0].status).toBe("solved");
    expect(mockPrisma.puzzleDelivery.findMany).not.toHaveBeenCalled();
  });

  it("mode=solved で line_user_id 無しは空配列（per-user モード）", async () => {
    const res = await GET(makeReq(undefined, "solved"), ctx);
    const json = await res.json();
    expect(json.data.puzzles).toEqual([]);
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
  });
});
