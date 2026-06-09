/**
 * src/__tests__/location-qr-success-message.test.ts
 *
 * PATCH /api/locations/:id の qr_success_message_id 取り扱いを検証する。
 * - 設定できる / null で解除できる / 空文字は null に正規化
 * - 他Work / 存在しない messageId は拒否（client 値を信用せず DB scope 検証）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLocation = { findUnique: vi.fn(), update: vi.fn() };
const mockMessage = { findUnique: vi.fn() };
const mockTransition = { findUnique: vi.fn() };

vi.mock("@/lib/prisma", () => ({
  prisma: { location: mockLocation, message: mockMessage, transition: mockTransition },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "user-1" }),
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/rbac", () => ({
  requireRole: (...a: unknown[]) => mockRequireRole(...a),
}));

const mockRequirePlan = vi.fn();
vi.mock("@/lib/plan-guard", () => ({
  requirePlanFeature: (...a: unknown[]) => mockRequirePlan(...a),
}));

function makeReq(body: unknown) {
  return new Request("http://localhost/api/locations/loc-1", {
    method:  "PATCH",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
}

async function callPatch(body: unknown) {
  const { PATCH } = await import("@/app/api/locations/[id]/route");
  // withAuth mock は (req, ctx) を素通しする。params は同期オブジェクト。
  return PATCH(makeReq(body) as never, { params: { id: "loc-1" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLocation.findUnique.mockResolvedValue({ id: "loc-1", workId: "work-1", work: { oaId: "oa-1" } });
  mockRequireRole.mockResolvedValue({ ok: true, role: "tester", status: "active" });
  mockRequirePlan.mockResolvedValue({ ok: true, plan: "pro" });
  // update は toResponse 用に渡された data を反映した行を返す
  mockLocation.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "loc-1", publicId: "pub1", workId: "work-1", name: "L", description: null,
    beaconUuid: null, beaconMajor: null, beaconMinor: null, latitude: null, longitude: null, radiusMeters: null,
    checkinMode: "qr_only", cooldownSeconds: 300, transitionId: null, setFlags: "{}",
    sortOrder: 0, isActive: true, stampEnabled: true, stampLabel: null, stampOrder: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    qrSuccessMessageId: (data.qrSuccessMessageId as string | null | undefined) ?? null,
    transition: null,
  }));
});

describe("PATCH /api/locations/:id — qr_success_message_id", () => {
  it("同一Workのメッセージを設定できる", async () => {
    mockMessage.findUnique.mockResolvedValue({ workId: "work-1" });
    const res = await callPatch({ qr_success_message_id: "11111111-1111-1111-1111-111111111111" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.qr_success_message_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(mockLocation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ qrSuccessMessageId: "11111111-1111-1111-1111-111111111111" }),
    }));
  });

  it("null で解除できる（message scope 検証はスキップ）", async () => {
    const res = await callPatch({ qr_success_message_id: null });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.qr_success_message_id).toBeNull();
    expect(mockLocation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ qrSuccessMessageId: null }),
    }));
    expect(mockMessage.findUnique).not.toHaveBeenCalled();
  });

  it("空文字は null に正規化される", async () => {
    const res = await callPatch({ qr_success_message_id: "" });
    expect(res.status).toBe(200);
    expect(mockLocation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ qrSuccessMessageId: null }),
    }));
    expect(mockMessage.findUnique).not.toHaveBeenCalled();
  });

  it("他Workのメッセージは 400 で拒否（送信しない）", async () => {
    mockMessage.findUnique.mockResolvedValue({ workId: "other-work" });
    const res = await callPatch({ qr_success_message_id: "22222222-2222-2222-2222-222222222222" });
    expect(res.status).toBe(400);
    expect(mockLocation.update).not.toHaveBeenCalled();
  });

  it("存在しない messageId は 404 で拒否", async () => {
    mockMessage.findUnique.mockResolvedValue(null);
    const res = await callPatch({ qr_success_message_id: "33333333-3333-3333-3333-333333333333" });
    expect(res.status).toBe(404);
    expect(mockLocation.update).not.toHaveBeenCalled();
  });

  it("不正な UUID 形式は 400（schema 検証）", async () => {
    const res = await callPatch({ qr_success_message_id: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mockLocation.update).not.toHaveBeenCalled();
  });

  it("qr_success_message_id 未指定の更新では touch しない（既存挙動を壊さない）", async () => {
    const res = await callPatch({ name: "新しい名前" });
    expect(res.status).toBe(200);
    const dataArg = mockLocation.update.mock.calls[0][0].data as Record<string, unknown>;
    expect("qrSuccessMessageId" in dataArg).toBe(false);
    expect(dataArg.name).toBe("新しい名前");
  });
});
