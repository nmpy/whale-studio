// src/__tests__/announcement-settings-api.test.ts
// お知らせ表示件数 設定API と お知らせ取得APIの順序/絞り込みの検証。
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = {
  studioSetting:     { findUnique: vi.fn(), upsert: vi.fn() },
  adminAnnouncement: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// withAuth / withPlatformAdmin は素通り（認可は別テストで担保）。
vi.mock("@/lib/auth", () => ({
  withAuth: <T>(h: (req: unknown, ctx: { params: T }, u: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => h(req, ctx, { id: "user-1" }),
}));
vi.mock("@/lib/with-platform-admin", () => ({
  withPlatformAdmin: <T>(h: (req: unknown, ctx: { params: T }, u: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => h(req, ctx, { id: "admin-1" }),
}));

function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/announcement-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
const getReq = () => new Request("http://localhost/x") as unknown as import("next/server").NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/announcement-settings（表示用）", () => {
  it("未設定（行なし）→ display_limit=3", async () => {
    mockPrisma.studioSetting.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/announcement-settings/route");
    const res = await GET(getReq(), { params: {} } as never);
    const j = await (res as Response).json();
    expect(j.data.display_limit).toBe(3);
  });
  it("null 値 → 3 / 範囲外 → clamp", async () => {
    mockPrisma.studioSetting.findUnique.mockResolvedValue({ announcementDisplayLimit: null });
    const { GET } = await import("@/app/api/announcement-settings/route");
    expect((await (await GET(getReq(), { params: {} } as never)).json()).data.display_limit).toBe(3);

    mockPrisma.studioSetting.findUnique.mockResolvedValue({ announcementDisplayLimit: 99 });
    expect((await (await GET(getReq(), { params: {} } as never)).json()).data.display_limit).toBe(10);

    mockPrisma.studioSetting.findUnique.mockResolvedValue({ announcementDisplayLimit: 5 });
    expect((await (await GET(getReq(), { params: {} } as never)).json()).data.display_limit).toBe(5);
  });
  it("DB エラー（テーブル未作成等）→ 既定3にフォールバック", async () => {
    mockPrisma.studioSetting.findUnique.mockRejectedValue(new Error("relation does not exist"));
    const { GET } = await import("@/app/api/announcement-settings/route");
    const j = await (await GET(getReq(), { params: {} } as never)).json();
    expect(j.data.display_limit).toBe(3);
  });
});

describe("PATCH /api/admin/announcement-settings（管理）", () => {
  it("1〜10 を upsert（id=singleton）し normalize 後の値を返す", async () => {
    mockPrisma.studioSetting.upsert.mockResolvedValue({ announcementDisplayLimit: 5 });
    const { PATCH } = await import("@/app/api/admin/announcement-settings/route");
    const res = await PATCH(patchReq({ display_limit: 5 }), { params: {} } as never);
    const j = await (res as Response).json();
    expect(j.data.display_limit).toBe(5);
    expect(mockPrisma.studioSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where:  { id: "singleton" },
      create: { id: "singleton", announcementDisplayLimit: 5 },
      update: { announcementDisplayLimit: 5 },
    }));
  });
  it("範囲外 99 は 10 に clamp して保存", async () => {
    mockPrisma.studioSetting.upsert.mockResolvedValue({ announcementDisplayLimit: 10 });
    const { PATCH } = await import("@/app/api/admin/announcement-settings/route");
    await PATCH(patchReq({ display_limit: 99 }), { params: {} } as never);
    expect(mockPrisma.studioSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { announcementDisplayLimit: 10 },
    }));
  });
  it("display_limit 欠如は 400", async () => {
    const { PATCH } = await import("@/app/api/admin/announcement-settings/route");
    const res = await PATCH(patchReq({}), { params: {} } as never);
    expect((res as Response).status).toBe(400);
    expect(mockPrisma.studioSetting.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/announcements（公開済みのみ・新しい日付順）", () => {
  it("publishedAt!=null かつ <=now で絞り、publishedAt desc で安定ソート", async () => {
    mockPrisma.adminAnnouncement.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/announcements/route");
    await GET(getReq(), { params: {} } as never);
    const arg = mockPrisma.adminAnnouncement.findMany.mock.calls[0][0];
    expect(arg.where.publishedAt.not).toBeNull();
    expect(arg.where.publishedAt.lte).toBeInstanceOf(Date);
    expect(arg.orderBy[0]).toEqual({ publishedAt: "desc" });
    // important ピン留めを使っていないこと
    expect(JSON.stringify(arg.orderBy)).not.toContain("important");
  });
});
