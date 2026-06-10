/**
 * src/__tests__/beacon-api-rbac.test.ts
 *
 * BeaconTrigger CRUD の RBAC ガード検証。
 * - GET は viewer 以上が通る
 * - POST / PATCH / DELETE は editor 以上のみ通る（tester / viewer は拒否）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── モック ───────────────────────────────────────────────
const mockBeaconTrigger = {
  findMany:   vi.fn(),
  findUnique: vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
  delete:     vi.fn(),
};
const mockBeaconEventLog = {
  findMany: vi.fn(),
};
const mockWork = {
  findUnique: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    beaconTrigger:  mockBeaconTrigger,
    beaconEventLog: mockBeaconEventLog,
    work:           mockWork,
  },
}));

// withAuth を素通り、user は固定
vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "user-1" }),
}));

const mockRequireRole = vi.fn();
const mockGetOaIdFromWorkId = vi.fn(async () => "oa-1");

vi.mock("@/lib/rbac", () => ({
  requireRole:        (...args: unknown[]) => mockRequireRole(...args),
  getOaIdFromWorkId:  (...args: unknown[]) => mockGetOaIdFromWorkId(...args),
}));

// プラン gate は本テストの対象外（RBAC 検証）。常に許可で素通り。
vi.mock("@/lib/plan-guard", () => ({
  requirePlanFeature: vi.fn(async () => ({ ok: true, plan: "pro" })),
}));

// ── ヘルパー ─────────────────────────────────────────────
function forbiddenResponse() {
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "権限が不足しています" } }),
      { status: 403, headers: { "content-type": "application/json" } },
    ),
  };
}

function makeReq(body?: unknown) {
  return new Request("http://localhost/api/works/work-1/beacons", {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── テスト ───────────────────────────────────────────────
describe("Beacon API RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/works/:workId/beacons", () => {
    it("tester は POST を作成できない（403）", async () => {
      mockRequireRole.mockResolvedValue(forbiddenResponse());

      const { POST } = await import("@/app/api/works/[workId]/beacons/route");
      const res = await POST(
        makeReq({ name: "test", hwid: "abc123", action_type: "send_message", action_payload: { text: "hi" } }) as any,
        { params: Promise.resolve({ workId: "work-1" }) } as any,
      );
      expect(res.status).toBe(403);
      // editor 権限を要求していること
      expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", "editor");
      expect(mockBeaconTrigger.create).not.toHaveBeenCalled();
    });

    it("viewer は POST を作成できない（403）", async () => {
      mockRequireRole.mockResolvedValue(forbiddenResponse());

      const { POST } = await import("@/app/api/works/[workId]/beacons/route");
      const res = await POST(
        makeReq({ name: "test", hwid: "abc123", action_type: "send_message", action_payload: { text: "hi" } }) as any,
        { params: Promise.resolve({ workId: "work-1" }) } as any,
      );
      expect(res.status).toBe(403);
      expect(mockBeaconTrigger.create).not.toHaveBeenCalled();
    });

    it("editor は POST で作成できる", async () => {
      mockRequireRole.mockResolvedValue({ ok: true, role: "editor", status: "active" });
      mockBeaconTrigger.findUnique.mockResolvedValue(null); // 重複なし
      mockWork.findUnique.mockResolvedValue({ oaId: "oa-1" });
      mockBeaconTrigger.create.mockResolvedValue({
        id: "trg-new",
        oaId: "oa-1",
        workId: "work-1",
        name: "test",
        hwid: "abc123",
        enabled: true,
        eventTypes: "enter",
        cooldownSeconds: 300,
        actionType: "send_message",
        actionPayload: { text: "hi" },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { POST } = await import("@/app/api/works/[workId]/beacons/route");
      const res = await POST(
        makeReq({ name: "test", hwid: "ABC123", action_type: "send_message", action_payload: { text: "hi" } }) as any,
        { params: Promise.resolve({ workId: "work-1" }) } as any,
      );

      expect(res.status).toBe(201);
      expect(mockBeaconTrigger.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          oaId: "oa-1",
          hwid: "abc123", // 正規化済み
        }),
      }));
    });
  });

  describe("PATCH/DELETE /api/works/:workId/beacons/:beaconId", () => {
    it("tester は PATCH できない（403）", async () => {
      mockRequireRole.mockResolvedValue(forbiddenResponse());

      const { PATCH } = await import("@/app/api/works/[workId]/beacons/[beaconId]/route");
      const res = await PATCH(
        new Request("http://localhost/api/works/work-1/beacons/trg-1", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }) as any,
        { params: Promise.resolve({ workId: "work-1", beaconId: "trg-1" }) } as any,
      );
      expect(res.status).toBe(403);
      expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", "editor");
      expect(mockBeaconTrigger.update).not.toHaveBeenCalled();
    });

    it("tester は DELETE できない（403）", async () => {
      mockRequireRole.mockResolvedValue(forbiddenResponse());

      const { DELETE } = await import("@/app/api/works/[workId]/beacons/[beaconId]/route");
      const res = await DELETE(
        new Request("http://localhost/api/works/work-1/beacons/trg-1", { method: "DELETE" }) as any,
        { params: Promise.resolve({ workId: "work-1", beaconId: "trg-1" }) } as any,
      );
      expect(res.status).toBe(403);
      expect(mockBeaconTrigger.delete).not.toHaveBeenCalled();
    });

    it("editor は DELETE できる", async () => {
      mockRequireRole.mockResolvedValue({ ok: true, role: "editor", status: "active" });
      mockBeaconTrigger.findUnique.mockResolvedValue({
        id: "trg-1",
        oaId: "oa-1",
      });
      mockBeaconTrigger.delete.mockResolvedValue({ id: "trg-1" });

      const { DELETE } = await import("@/app/api/works/[workId]/beacons/[beaconId]/route");
      const res = await DELETE(
        new Request("http://localhost/api/works/work-1/beacons/trg-1", { method: "DELETE" }) as any,
        { params: Promise.resolve({ workId: "work-1", beaconId: "trg-1" }) } as any,
      );
      expect(res.status).toBe(204);
      expect(mockBeaconTrigger.delete).toHaveBeenCalledWith({ where: { id: "trg-1" } });
    });
  });

  describe("GET /api/works/:workId/beacons", () => {
    it("viewer は GET できる", async () => {
      mockRequireRole.mockResolvedValue({ ok: true, role: "viewer", status: "active" });
      mockBeaconTrigger.findMany.mockResolvedValue([]);
      mockBeaconEventLog.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/works/[workId]/beacons/route");
      const res = await GET(
        makeReq() as any,
        { params: Promise.resolve({ workId: "work-1" }) } as any,
      );
      expect(res.status).toBe(200);
      expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", "viewer");
    });
  });
});
