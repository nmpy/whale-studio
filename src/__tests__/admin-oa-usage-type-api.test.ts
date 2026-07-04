/**
 * src/__tests__/admin-oa-usage-type-api.test.ts
 *
 * PATCH /api/admin/oas/[oaId]/usage-type の検証。
 * - platform admin のみ変更可（非該当は 404 秘匿）
 * - usage_type は personal / business のみ許可（不正値は 400）
 * - 成功時に Oa.usageType を更新し、更新後データを返す
 * - 判定は usageType のみ（作品名/プラン名/特定 ID に依存しない）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockOa, mockAudit, mockIsPlatformOwner } = vi.hoisted(() => ({
  mockOa: { findUnique: vi.fn(), update: vi.fn() },
  mockAudit: { create: vi.fn(async () => ({})) },
  mockIsPlatformOwner: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { oa: mockOa, adminAuditLog: mockAudit },
}));

// withAuth を素通り、user は固定。
vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "actor-1" }),
}));

vi.mock("@/lib/platform-admin", () => ({
  isPlatformOwner: (...args: unknown[]) => mockIsPlatformOwner(...args),
}));

import { PATCH } from "@/app/api/admin/oas/[oaId]/usage-type/route";

function req(body: unknown) {
  return { json: async () => body } as unknown as Request;
}
const ctx = (oaId: string) => ({ params: { oaId } });

async function callPatch(body: unknown, oaId = "oa-1") {
  // withAuth モックにより (req, ctx) の 2 引数で呼べる。
  const res = (await (PATCH as unknown as (r: Request, c: unknown) => Promise<Response>)(req(body), ctx(oaId)));
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOa.findUnique.mockResolvedValue({ id: "oa-1", title: "テスト作品", usageType: "personal" });
  mockOa.update.mockImplementation(async ({ data }: { data: { usageType: string } }) => ({
    id: "oa-1", title: "テスト作品", usageType: data.usageType,
  }));
});

describe("PATCH /api/admin/oas/[oaId]/usage-type", () => {
  it("platform admin 以外は 404（存在秘匿）で、更新しない", async () => {
    mockIsPlatformOwner.mockReturnValue(false);
    const { status } = await callPatch({ usage_type: "business" });
    expect(status).toBe(404);
    expect(mockOa.update).not.toHaveBeenCalled();
  });

  it("platform admin は business へ更新できる（Oa.usageType=business）", async () => {
    mockIsPlatformOwner.mockReturnValue(true);
    const { status, json } = await callPatch({ usage_type: "business" });
    expect(status).toBe(200);
    expect(mockOa.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "oa-1" }, data: { usageType: "business" },
    }));
    expect(json.data).toMatchObject({ id: "oa-1", usage_type: "business" });
  });

  it("platform admin は personal へも戻せる", async () => {
    mockIsPlatformOwner.mockReturnValue(true);
    const { status, json } = await callPatch({ usage_type: "personal" });
    expect(status).toBe(200);
    expect(json.data.usage_type).toBe("personal");
  });

  it("不正な usage_type は 400（personal/business のみ許可）", async () => {
    mockIsPlatformOwner.mockReturnValue(true);
    const { status } = await callPatch({ usage_type: "corporate" });
    expect(status).toBe(400);
    expect(mockOa.update).not.toHaveBeenCalled();
  });

  it("存在しない OA は 404", async () => {
    mockIsPlatformOwner.mockReturnValue(true);
    mockOa.findUnique.mockResolvedValue(null);
    const { status } = await callPatch({ usage_type: "business" });
    expect(status).toBe(404);
    expect(mockOa.update).not.toHaveBeenCalled();
  });

  it("成功時は監査ログを記録する（oa_usage_type）", async () => {
    mockIsPlatformOwner.mockReturnValue(true);
    await callPatch({ usage_type: "business" });
    expect(mockAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: "actor-1", action: "update", resource: "oa_usage_type", resourceId: "oa-1" }),
    }));
  });
});
