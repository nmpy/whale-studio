/**
 * src/__tests__/content-delete-reorder-rbac.test.ts
 *
 * 作品配下コンテンツの「削除・表示順変更・破壊的chain保存」を owner 限定 → editor 以上に緩和した変更の検証。
 *
 * 方針: 各 route が認可で渡す最低ロール（requireRole の第3引数 / withRole の role 引数）が
 *   - 削除・並び替え・破壊的chain = "editor"
 *   - 更新のみ chain = "tester"（現行維持）
 *   になっていることを確認する。requireRole("editor") は roleAtLeast により
 *   editor/admin/owner を通し tester/viewer を 403 で弾く（= 既存 rbac テストが担保）。
 *   よって「閾値が editor であること」を確認すれば「editor/admin/owner 可・tester/viewer 不可」が成立する。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const UUID = "00000000-0000-4000-8000-000000000001";

// ── prisma モック（requireRole 前のエンティティ取得だけ満たす） ──
const mockPrisma = {
  message:   { findUnique: vi.fn() },
  phase:     { findUnique: vi.fn() },
  character: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// ── auth: withAuth は素通り（user-1）、withRole は role 引数を記録 ──
const withRoleCalls: Array<{ role: unknown }> = [];
vi.mock("@/lib/auth", () => ({
  withAuth: <T>(handler: (req: unknown, ctx: { params: T }, user: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => handler(req, ctx, { id: "user-1" }),
  withRole: <T>(_wsFn: unknown, role: unknown, _handler: unknown) => {
    withRoleCalls.push({ role });
    return (_req: unknown, _ctx: { params: T }) =>
      new Response(JSON.stringify({ stub: true }), { status: 200 });
  },
}));

// ── rbac: requireRole は forbidden を返しつつ引数を記録（下流は走らない＝最小モック） ──
const requireRoleCalls: Array<{ workspaceId: unknown; userId: unknown; role: unknown }> = [];
function forbidden() {
  return {
    ok: false as const,
    response: new Response(
      JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "権限が不足しています" } }),
      { status: 403, headers: { "content-type": "application/json" } },
    ),
  };
}
vi.mock("@/lib/rbac", () => ({
  requireRole: (workspaceId: unknown, userId: unknown, role: unknown) => {
    requireRoleCalls.push({ workspaceId, userId, role });
    return Promise.resolve(forbidden());
  },
  getOaIdFromWorkId:  vi.fn(async () => "oa-1"),
  getOaIdFromPhaseId: vi.fn(async () => "oa-1"),
}));

// プラン gate / cache は本テスト対象外。素通りスタブ。
vi.mock("@/lib/plan-guard", () => ({
  getCurrentPlanTierForOa: vi.fn(async () => "pro"),
  requirePlanFeature:      vi.fn(async () => ({ ok: true, plan: "pro" })),
}));
vi.mock("@/lib/cache", () => ({
  activeCache: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), delete: vi.fn() },
  CACHE_KEY: { globalKw: (x: string) => `gk:${x}` },
}));

const lastRequireRole = () => requireRoleCalls[requireRoleCalls.length - 1];

function jsonReq(method: string, body?: unknown) {
  return new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleCalls.length = 0;
  withRoleCalls.length = 0;
  mockPrisma.message.findUnique.mockResolvedValue({
    id: "m1", workId: "w1", work: { oaId: "oa-1" }, phase: { phaseType: "normal" },
  });
  mockPrisma.phase.findUnique.mockResolvedValue({
    id: "p1", workId: "w1", work: { oaId: "oa-1" }, phaseType: "normal",
  });
  mockPrisma.character.findUnique.mockResolvedValue({
    id: "c1", workId: "w1", work: { oaId: "oa-1" },
  });
});

describe("メッセージ削除 DELETE /api/messages/[id] は editor 以上", () => {
  it("requireRole が 'editor' で呼ばれ、拒否時は 403", async () => {
    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(jsonReq("DELETE"), { params: { id: "m1" } } as never);
    expect(lastRequireRole().role).toBe("editor");
    expect((res as Response).status).toBe(403);
  });
});

describe("表示順変更 PATCH /api/messages/reorder は editor 以上", () => {
  it("requireRole が 'editor' で呼ばれ、拒否時は 403", async () => {
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    const res = await PATCH(jsonReq("PATCH", { work_id: "w1", message_ids: ["m1", "m2"] }), { params: {} } as never);
    expect(lastRequireRole().role).toBe("editor");
    expect((res as Response).status).toBe(403);
  });
});

describe("チェーン保存 PUT /api/messages/chain", () => {
  it("削除を含む（removed_message_ids あり）→ editor 以上", async () => {
    const { PUT } = await import("@/app/api/messages/chain/route");
    const res = await PUT(jsonReq("PUT", { work_id: "w1", head_id: UUID, slots: [], removed_message_ids: [UUID] }), { params: {} } as never);
    expect(lastRequireRole().role).toBe("editor");
    expect((res as Response).status).toBe(403);
  });
  it("更新のみ（removed なし）→ tester（現行維持）", async () => {
    const { PUT } = await import("@/app/api/messages/chain/route");
    await PUT(jsonReq("PUT", { work_id: "w1", head_id: UUID, slots: [] }), { params: {} } as never);
    expect(lastRequireRole().role).toBe("tester");
  });
});

describe("フェーズ削除 DELETE /api/phases/[id] は editor 以上", () => {
  it("requireRole が 'editor' で呼ばれ、拒否時は 403", async () => {
    const { DELETE } = await import("@/app/api/phases/[id]/route");
    const res = await DELETE(jsonReq("DELETE"), { params: { id: "p1" } } as never);
    expect(lastRequireRole().role).toBe("editor");
    expect((res as Response).status).toBe(403);
  });
});

describe("キャラクター削除 DELETE /api/characters/[id] は editor 以上", () => {
  it("requireRole が 'editor' で呼ばれ、拒否時は 403", async () => {
    const { DELETE } = await import("@/app/api/characters/[id]/route");
    const res = await DELETE(jsonReq("DELETE"), { params: { id: "c1" } } as never);
    expect(lastRequireRole().role).toBe("editor");
    expect((res as Response).status).toBe(403);
  });
});

describe("謎削除 DELETE /api/oas/[id]/riddles/[rid] は editor 以上（withRole）", () => {
  it("withRole の DELETE が role='editor'、PATCH は 'tester' のまま", async () => {
    await import("@/app/api/oas/[id]/riddles/[rid]/route");
    // 登録順: GET, PATCH('tester'), DELETE('editor')
    const roles = withRoleCalls.map((c) => c.role);
    expect(roles).toContain("editor");           // DELETE
    expect(roles).toContain("tester");           // PATCH（更新は現行維持）
    expect(roles[roles.length - 1]).toBe("editor"); // 最後の登録＝DELETE
  });
});
