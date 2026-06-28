/**
 * src/__tests__/messages-reorder.test.ts
 *
 * PATCH /api/messages/reorder のユニットテスト。
 *
 * 検証:
 *  1. 認可: owner 以外は 403
 *  2. cross-work guard: 別 work の messageId が混ざれば 400
 *  3. body validation: message_ids 空 / 重複は 400
 *  4. 正常系: 渡された順序で sortOrder=0,1,2 が更新される (transaction で)
 *  5. キャッシュ無効化: 影響を受ける phase / global キーが invalidate される
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── モック ───────────────────────────────────────────────
const mockMessage = {
  findMany: vi.fn(),
  update:   vi.fn(),
};
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message:       mockMessage,
    $transaction:  (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => handler(req, ctx, { id: "user-1" }),
}));

const mockRequireRole       = vi.fn();
const mockGetOaIdFromWorkId = vi.fn(async (..._args: unknown[]) => "oa-1");

vi.mock("@/lib/rbac", () => ({
  requireRole:       (...args: unknown[]) => mockRequireRole(...args),
  getOaIdFromWorkId: (...args: unknown[]) => mockGetOaIdFromWorkId(...args),
}));

const mockCacheDelete = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/cache", () => ({
  activeCache: {
    delete: (...args: unknown[]) => mockCacheDelete(...args),
  },
  CACHE_KEY: {
    phase:     (id: string) => `phase:${id}`,
    startMsgs: (id: string) => `startMsgs:${id}`,
    globalKw:  (id: string) => `globalKw:${id}`,
  },
}));

function forbiddenResponse() {
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ success: false, error: { code: "FORBIDDEN" } }),
      { status: 403, headers: { "content-type": "application/json" } },
    ),
  };
}

function okRole() {
  return { ok: true, response: null };
}

function makeReq(body: unknown) {
  return new Request("http://localhost/api/messages/reorder", {
    method:  "PATCH",
    headers: { "content-type": "application/json" },
    body:    body === undefined ? undefined : JSON.stringify(body),
  });
}

// ── テスト ───────────────────────────────────────────────
describe("PATCH /api/messages/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (queries: unknown[]) => {
      // 配列で渡された場合は全件 update 完了を返す
      if (!Array.isArray(queries)) return queries;
      return queries.map(() => ({ count: 1 }));
    });
  });

  it("認可: owner でなければ 403", async () => {
    mockRequireRole.mockResolvedValue(forbiddenResponse());
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    const res = await PATCH(
      makeReq({ work_id: "w1", message_ids: ["m1", "m2"] }) as never,
      { params: {} } as never,
    );
    expect((res as Response).status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("validation: message_ids 空なら 400", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    const res = await PATCH(
      makeReq({ work_id: "w1", message_ids: [] }) as never,
      { params: {} } as never,
    );
    expect((res as Response).status).toBe(400);
  });

  it("validation: message_ids に重複があれば 400", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    const res = await PATCH(
      makeReq({ work_id: "w1", message_ids: ["m1", "m2", "m1"] }) as never,
      { params: {} } as never,
    );
    expect((res as Response).status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("cross-work guard: 別 work の messageId が混ざれば 400", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    // 渡された 3 件のうち 2 件しか該当 work に属していない
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", phaseId: "p1", phase: { phaseType: "normal" } },
      { id: "m2", phaseId: "p1", phase: { phaseType: "normal" } },
    ]);
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    const res = await PATCH(
      makeReq({ work_id: "w1", message_ids: ["m1", "m2", "m-from-other-work"] }) as never,
      { params: {} } as never,
    );
    expect((res as Response).status).toBe(400);
    const body = await (res as Response).json();
    expect(body.error?.message ?? "").toContain("属していません");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("正常系: 渡された順序で sortOrder=0,1,2 が prisma.message.update に渡される", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", phaseId: "p1", phase: { phaseType: "normal" } },
      { id: "m2", phaseId: "p1", phase: { phaseType: "normal" } },
      { id: "m3", phaseId: "p1", phase: { phaseType: "normal" } },
    ]);
    mockMessage.update.mockImplementation((args: { where: { id: string }; data: { sortOrder: number } }) => args);

    const { PATCH } = await import("@/app/api/messages/reorder/route");
    const res = await PATCH(
      // 並び順を反転して送る
      makeReq({ work_id: "w1", message_ids: ["m3", "m2", "m1"] }) as never,
      { params: {} } as never,
    );
    expect((res as Response).status).toBe(200);

    // transaction に渡された 3 件分の update calls を回収する
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const updateCalls = mockMessage.update.mock.calls.map((c: { where: { id: string }; data: { sortOrder: number } }[]) => c[0]);
    expect(updateCalls).toEqual([
      { where: { id: "m3" }, data: { sortOrder: 0 } },
      { where: { id: "m2" }, data: { sortOrder: 1 } },
      { where: { id: "m1" }, data: { sortOrder: 2 } },
    ]);
  });

  it("キャッシュ無効化: 影響を受ける phase のキー (phase / startMsgs) を delete する", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", phaseId: "p1", phase: { phaseType: "normal" } },
      { id: "m2", phaseId: "p2", phase: { phaseType: "normal" } },
    ]);
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    await PATCH(
      makeReq({ work_id: "w1", message_ids: ["m1", "m2"] }) as never,
      { params: {} } as never,
    );

    const deletedKeys = mockCacheDelete.mock.calls.map((c: unknown[]) => c[0]);
    expect(deletedKeys).toContain("phase:p1");
    expect(deletedKeys).toContain("phase:p2");
    expect(deletedKeys).toContain("startMsgs:p1");
    expect(deletedKeys).toContain("startMsgs:p2");
    expect(deletedKeys).not.toContain("globalKw:w1");  // = global は含まない
  });

  it("global キーワード (phaseId=null or phaseType=global) があれば globalKw キャッシュも delete", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", phaseId: null,  phase: null },                            // phaseId=null
      { id: "m2", phaseId: "p-g", phase: { phaseType: "global" } },        // global phase
    ]);
    const { PATCH } = await import("@/app/api/messages/reorder/route");
    await PATCH(
      makeReq({ work_id: "w1", message_ids: ["m1", "m2"] }) as never,
      { params: {} } as never,
    );
    const deletedKeys = mockCacheDelete.mock.calls.map((c: unknown[]) => c[0]);
    expect(deletedKeys).toContain("globalKw:w1");
  });
});
