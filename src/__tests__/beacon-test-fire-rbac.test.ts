/**
 * src/__tests__/beacon-test-fire-rbac.test.ts
 *
 * 疑似発火 API（POST /api/oas/[id]/beacons/test-fire）の検証。
 * - platform admin 以外は 403 で拒否し、handleBeaconEvent を呼ばない
 * - platform admin は本番と同じ handleBeaconEvent を isTest=true で通す
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock factory はファイル先頭へ巻き上げられ、route の static import 評価より先に走る。
// 参照する mock 群は vi.hoisted で同じく巻き上げて初期化順の問題を避ける。
const h = vi.hoisted(() => ({
  mockBeaconTrigger: { findUnique: vi.fn() },
  mockOa: { findUnique: vi.fn() },
  mockHandle: vi.fn((..._args: unknown[]) => Promise.resolve({ status: "sent" as const, reason: null as string | null, triggerId: "trg-1" })),
  state: { platformOwner: false },
}));
const { mockBeaconTrigger, mockOa, mockHandle } = h;

vi.mock("@/lib/prisma", () => ({
  prisma: { beaconTrigger: h.mockBeaconTrigger, oa: h.mockOa },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "user-1" }),
}));

vi.mock("@/lib/rbac", () => ({
  requireRole: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/platform-admin", () => ({
  isPlatformOwner: (..._args: unknown[]) => h.state.platformOwner,
}));

vi.mock("@/lib/beacon", () => ({
  handleBeaconEvent: (...args: unknown[]) => h.mockHandle(...args),
}));

vi.mock("@/lib/beacon-message", () => ({
  loadBeaconMessageChain: vi.fn(async () => null),
}));

vi.mock("@/lib/line", () => ({
  replyToLine: vi.fn(async () => {}),
  pushToLine:  vi.fn(async () => {}),
}));

import { POST } from "@/app/api/oas/[id]/beacons/test-fire/route";

function makeReq(body: unknown) {
  return new Request("http://localhost/api/oas/oa-1/beacons/test-fire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "oa-1" }) };

describe("POST /api/oas/[id]/beacons/test-fire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.platformOwner = false;
    mockBeaconTrigger.findUnique.mockResolvedValue({ id: "trg-1", oaId: "oa-1", hwid: "abc123" });
    mockOa.findUnique.mockResolvedValue({ id: "oa-1", title: "OA", channelAccessToken: "tok", serviceSuspendedAt: null });
  });

  it("platform admin でなければ 403 で拒否し、handleBeaconEvent を呼ばない", async () => {
    h.state.platformOwner = false;
    const res = await POST(makeReq({ beacon_trigger_id: "trg-1", line_user_id: "U_1" }) as any, ctx as any);
    expect(res.status).toBe(403);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it("platform admin は handleBeaconEvent を isTest=true で通す", async () => {
    h.state.platformOwner = true;
    const res = await POST(makeReq({ beacon_trigger_id: "trg-1", line_user_id: "U_1" }) as any, ctx as any);
    expect(res.status).toBe(200);
    expect(mockHandle).toHaveBeenCalledTimes(1);
    const arg = mockHandle.mock.calls[0][0] as { isTest?: boolean; event?: { source?: { userId?: string } } };
    expect(arg.isTest).toBe(true);
    expect(arg.event?.source?.userId).toBe("U_1");
  });

  it("line_user_id が無ければ 400（誤爆防止）", async () => {
    h.state.platformOwner = true;
    const res = await POST(makeReq({ beacon_trigger_id: "trg-1" }) as any, ctx as any);
    expect(res.status).toBe(400);
    expect(mockHandle).not.toHaveBeenCalled();
  });
});
