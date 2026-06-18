/**
 * src/__tests__/studio-invite.test.ts
 *
 * スタジオ管理「招待URL発行」(StudioInvite) の検証:
 *  - token/hash/有効期限(7日)/状態判定ヘルパー
 *  - 発行 API: owner/admin のみ発行できる（一般ユーザーは 403）
 *  - 受諾 API: 期限切れは受諾不可・副作用なし / 期限内は対象OAへ反映（usageType/role/plan）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── ヘルパーの単体検証（モック不要）─────────────────────────
import {
  generateStudioInviteToken, hashStudioInviteToken,
  resolveStudioInviteExpiresAt, studioInviteState,
  STUDIO_INVITE_EXPIRES_IN_DAYS, issueStudioInviteSchema,
} from "@/lib/studio-invite";

describe("studio-invite helpers", () => {
  it("token は十分長く毎回異なる / hash は決定的な sha256 hex(64)", () => {
    const a = generateStudioInviteToken();
    const b = generateStudioInviteToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    const h = hashStudioInviteToken(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStudioInviteToken(a)).toBe(h);
    expect(hashStudioInviteToken(b)).not.toBe(h);
  });

  it("有効期限は発行から7日後ちょうど", () => {
    expect(STUDIO_INVITE_EXPIRES_IN_DAYS).toBe(7);
    const now = new Date("2026-06-18T15:00:00Z");
    expect(resolveStudioInviteExpiresAt(now).toISOString()).toBe("2026-06-25T15:00:00.000Z");
  });

  it("状態判定: none > revoked > accepted > expired > active", () => {
    const now = new Date("2026-06-18T15:00:00Z");
    const past = new Date("2026-06-01T00:00:00Z");
    const future = new Date("2026-12-31T00:00:00Z");
    expect(studioInviteState(null, now)).toBe("none");
    expect(studioInviteState({ acceptedAt: now, revokedAt: now, expiresAt: future }, now)).toBe("revoked");
    expect(studioInviteState({ acceptedAt: past, revokedAt: null, expiresAt: future }, now)).toBe("accepted");
    expect(studioInviteState({ acceptedAt: null, revokedAt: null, expiresAt: past }, now)).toBe("expired");
    expect(studioInviteState({ acceptedAt: null, revokedAt: null, expiresAt: future }, now)).toBe("active");
  });

  it("発行入力スキーマ: owner ロールは受け付けない / 正常入力は通る", () => {
    expect(issueStudioInviteSchema.safeParse({ oa_id: "oa-1", usage_type: "business", plan_tier: "basic", role: "owner" }).success).toBe(false);
    const okParse = issueStudioInviteSchema.safeParse({ oa_id: "oa-1", usage_type: "personal", plan_tier: "pro", role: "editor" });
    expect(okParse.success).toBe(true);
  });
});

// ── API モック ───────────────────────────────────────────
const mockStudioInvite = { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() };
const mockOa = { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() };
const mockWorkspaceMember = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() };
const mockTx = {
  studioInvite:    { updateMany: vi.fn() },
  oa:              { update: vi.fn() },
  workspaceMember: { create: vi.fn(), update: vi.fn() },
};
const mock$transaction = vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studioInvite:    mockStudioInvite,
    oa:              mockOa,
    workspaceMember: mockWorkspaceMember,
    $transaction:    mock$transaction,
  },
}));

// withAuth は素通り、user 固定。
vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string; email?: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "user-1", email: "u@example.com" }),
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/rbac", () => ({ requireRole: (...a: unknown[]) => mockRequireRole(...a) }));
vi.mock("@/lib/platform-admin", () => ({ isPlatformOwner: () => false }));

function forbidden() {
  return {
    ok: false,
    response: new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "権限が不足しています" } }), { status: 403, headers: { "content-type": "application/json" } }),
  };
}
function makeReq(body?: unknown, path = "http://localhost/api/admin/studio-invites") {
  return new Request(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : "{}" });
}
const ISSUE_BODY = { oa_id: "oa-1", usage_type: "business", plan_tier: "standard", role: "editor" };

describe("StudioInvite 発行 API (RBAC)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
  });

  it("対象OAの owner/admin でないユーザーは発行できない（403）", async () => {
    mockRequireRole.mockResolvedValue(forbidden());
    const { POST } = await import("@/app/api/admin/studio-invites/route");
    const res = await (POST as any)(makeReq(ISSUE_BODY), { params: {} });
    expect(res.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", ["owner", "admin"]);
    expect(mockStudioInvite.create).not.toHaveBeenCalled();
  });

  it("owner/admin は招待URLを発行できる（201・invite_url 返却・expiresAt=7日後）", async () => {
    mockRequireRole.mockResolvedValue({ ok: true, role: "owner", status: "active" });
    mockOa.findUnique.mockResolvedValue({ id: "oa-1", title: "テストOA", serviceSuspendedAt: null });
    let capturedExpires: Date | null = null;
    mockStudioInvite.create.mockImplementation(async ({ data }: any) => {
      capturedExpires = data.expiresAt;
      return { id: "inv-1", oaId: data.oaId, usageType: data.usageType, planTier: data.planTier, role: data.role, expiresAt: data.expiresAt };
    });
    const { POST } = await import("@/app/api/admin/studio-invites/route");
    const res = await (POST as any)(makeReq(ISSUE_BODY), { params: {} });
    expect(res.status).toBe(201);
    const json = await res.json();
    const d = json.data ?? json;
    expect(d.invite_url).toContain("/studio-invites/");
    expect(mockStudioInvite.create).toHaveBeenCalledTimes(1);
    // expiresAt は約7日後（誤差1分以内）。
    const diffDays = (capturedExpires!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(6.99);
    expect(diffDays).toBeLessThan(7.01);
  });
});

describe("StudioInvite 受諾 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
  });

  it("期限切れは受諾できず、権限付与などの副作用を一切起こさない", async () => {
    mockStudioInvite.findUnique.mockResolvedValue({
      id: "inv-1", oaId: "oa-1", usageType: "business", planTier: "standard", role: "editor",
      acceptedAt: null, acceptedByUserId: null, revokedAt: null,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1日前 = 期限切れ
      createdByUserId: "owner-1", createdAt: new Date(),
      oa: { id: "oa-1", ownerKey: "owner-1", serviceSuspendedAt: null },
    });
    const { POST } = await import("@/app/api/studio-invites/[token]/accept/route");
    const res = await (POST as any)(new Request("http://localhost/api/studio-invites/t/accept", { method: "POST" }), { params: { token: "t" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain("登録までに一定期間を過ぎた");
    expect(mock$transaction).not.toHaveBeenCalled();
    expect(mockWorkspaceMember.create).not.toHaveBeenCalled();
    expect(mockOa.update).not.toHaveBeenCalled();
  });

  it("期限内は対象OAへ反映（usageType 更新・メンバー作成 role 反映・招待を消費）", async () => {
    mockStudioInvite.findUnique.mockResolvedValue({
      id: "inv-1", oaId: "oa-1", usageType: "business", planTier: "standard", role: "editor",
      acceptedAt: null, acceptedByUserId: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1日後 = 有効
      createdByUserId: "owner-1", createdAt: new Date("2026-06-18T00:00:00Z"),
      oa: { id: "oa-1", ownerKey: "owner-other", serviceSuspendedAt: null },
    });
    mockWorkspaceMember.findUnique.mockResolvedValue(null); // 未参加
    mockTx.studioInvite.updateMany.mockResolvedValue({ count: 1 }); // 消費成功

    const { POST } = await import("@/app/api/studio-invites/[token]/accept/route");
    const res = await (POST as any)(new Request("http://localhost/api/studio-invites/t/accept", { method: "POST" }), { params: { token: "t" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    const d = json.data ?? json;
    expect(d.role).toBe("editor");
    expect(d.usage_type).toBe("business");
    expect(d.plan_tier).toBe("standard");
    // 反映処理
    expect(mockTx.studioInvite.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.oa.update).toHaveBeenCalledWith(expect.objectContaining({ data: { usageType: "business" } }));
    expect(mockTx.workspaceMember.create).toHaveBeenCalledTimes(1);
    const createArg = mockTx.workspaceMember.create.mock.calls[0][0];
    expect(createArg.data.role).toBe("editor");
    expect(createArg.data.status).toBe("active");
  });
});
