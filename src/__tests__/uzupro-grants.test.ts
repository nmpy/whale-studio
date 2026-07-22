// src/__tests__/uzupro-grants.test.ts
// /api/admin/uzu-pro-grants（platform owner 専用）の認可 + 監査ログ検証:
//   - platform owner: GET 一覧 / POST 付与(upsert + AdminAuditLog create) / DELETE 解除(deleteMany + AdminAuditLog delete)
//   - 非 platform owner: すべて 403 で DB 書き込みなし
// withAuth / getAuthUser / isPlatformOwner / prisma は mock。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp } = vi.hoisted(() => ({
  mp: {
    uzuProGrant: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

// withAuth は「認証済み user を渡す薄いラッパ」として mock（handler をそのまま束ねる）。
const { currentUser } = vi.hoisted(() => ({ currentUser: { id: "platform-owner" } as { id: string } }));
vi.mock("@/lib/auth", () => ({
  withAuth: (handler: (req: NextRequest, ctx: unknown, user: { id: string }) => Promise<unknown>) =>
    (req: NextRequest, ctx: unknown) => handler(req, ctx, currentUser),
  getAuthUser: vi.fn(async () => currentUser),
}));

const { isPlatformOwner } = vi.hoisted(() => ({ isPlatformOwner: vi.fn(() => true) }));
vi.mock("@/lib/platform-admin", () => ({ isPlatformOwner }));

import { GET, POST, DELETE } from "@/app/api/admin/uzu-pro-grants/route";

const postReq = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/uzu-pro-grants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const delReq = (qs?: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/admin/uzu-pro-grants${qs ? `?${qs}` : ""}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const getReq = () => new NextRequest("http://localhost/api/admin/uzu-pro-grants", { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  isPlatformOwner.mockReturnValue(true);
  currentUser.id = "platform-owner";
});

describe("uzu-pro-grants (platform owner)", () => {
  it("GET: 一覧を createdAt desc で返す（PII フィールドは select しない）", async () => {
    mp.uzuProGrant.findMany.mockResolvedValue([{ userId: "u1", grantedBy: "platform-owner", note: null, createdAt: new Date() }]);
    const res = await GET(getReq(), { params: {} } as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.grants).toHaveLength(1);
    expect(mp.uzuProGrant.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });
  });

  it("POST: upsert で付与し AdminAuditLog に create を書く", async () => {
    mp.uzuProGrant.upsert.mockResolvedValue({ userId: "u1" });
    mp.adminAuditLog.create.mockResolvedValue({});
    const res = await POST(postReq({ userId: "u1", note: "vip" }), { params: {} } as never);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data).toEqual({ userId: "u1" });
    expect(mp.uzuProGrant.upsert.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(mp.uzuProGrant.upsert.mock.calls[0][0].create).toMatchObject({ userId: "u1", grantedBy: "platform-owner", note: "vip" });
    expect(mp.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: "platform-owner", action: "create", resource: "uzu_pro_grant", resourceId: "u1",
    });
  });

  it("POST: userId 欠落は 400（upsert しない）", async () => {
    const res = await POST(postReq({ note: "x" }), { params: {} } as never);
    expect(res.status).toBe(400);
    expect(mp.uzuProGrant.upsert).not.toHaveBeenCalled();
    expect(mp.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("DELETE(?userId=): deleteMany + AdminAuditLog delete、revoked=true", async () => {
    mp.uzuProGrant.deleteMany.mockResolvedValue({ count: 1 });
    mp.adminAuditLog.create.mockResolvedValue({});
    const res = await DELETE(delReq("userId=u1"), { params: {} } as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ userId: "u1", revoked: true });
    expect(mp.uzuProGrant.deleteMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(mp.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: "platform-owner", action: "delete", resource: "uzu_pro_grant", resourceId: "u1",
    });
  });

  it("DELETE(body userId): query が無くても body から解決し冪等（revoked=false）", async () => {
    mp.uzuProGrant.deleteMany.mockResolvedValue({ count: 0 });
    mp.adminAuditLog.create.mockResolvedValue({});
    const res = await DELETE(delReq(undefined, { userId: "u1" }), { params: {} } as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ userId: "u1", revoked: false });
  });
});

describe("uzu-pro-grants (非 platform owner)", () => {
  beforeEach(() => isPlatformOwner.mockReturnValue(false));

  it("GET は 403 で findMany しない", async () => {
    const res = await GET(getReq(), { params: {} } as never);
    expect(res.status).toBe(403);
    expect(mp.uzuProGrant.findMany).not.toHaveBeenCalled();
  });

  it("POST は 403 で upsert / 監査ログを書かない", async () => {
    const res = await POST(postReq({ userId: "u1" }), { params: {} } as never);
    expect(res.status).toBe(403);
    expect(mp.uzuProGrant.upsert).not.toHaveBeenCalled();
    expect(mp.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("DELETE は 403 で deleteMany / 監査ログを書かない", async () => {
    const res = await DELETE(delReq("userId=u1"), { params: {} } as never);
    expect(res.status).toBe(403);
    expect(mp.uzuProGrant.deleteMany).not.toHaveBeenCalled();
    expect(mp.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
