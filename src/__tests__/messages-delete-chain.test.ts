/**
 * src/__tests__/messages-delete-chain.test.ts
 *
 * DELETE /api/messages/:id の chain 連鎖削除を検証する。
 *
 * 仕様:
 *  - chain head 削除時に next_message_id で連結された continuation も一括削除する
 *  - 同じ work_id に属する message のみを walk する (= 他 work 混入防止)
 *  - 循環参照を防止する
 *  - 上限 10 件で打ち切る
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── モック ───────────────────────────────────────────────
const mockMessage = {
  findUnique: vi.fn(),
  findMany:   vi.fn(),
  delete:     vi.fn(),
};
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message:      mockMessage,
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => handler(req, ctx, { id: "user-1" }),
}));

const mockRequireRole = vi.fn();
vi.mock("@/lib/rbac", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockCacheDelete = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/cache", () => ({
  activeCache: { delete: (...args: unknown[]) => mockCacheDelete(...args) },
  CACHE_KEY: {
    phase:     (id: string) => `phase:${id}`,
    startMsgs: (id: string) => `startMsgs:${id}`,
    globalKw:  (id: string) => `globalKw:${id}`,
  },
}));

vi.mock("@/lib/puzzle-answer", () => ({
  parseAnswerMatchType: vi.fn(),
}));

vi.mock("@/lib/validations", () => ({
  updateMessageSchema: { safeParse: vi.fn() },
  formatZodErrors:     vi.fn(),
}));

function okRole() {
  return { ok: true, response: null };
}

function makeReq() {
  return new Request("http://localhost/api/messages/m1", { method: "DELETE" });
}

// ── テスト ───────────────────────────────────────────────
describe("DELETE /api/messages/:id chain cascade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 既定では外部参照なし（#6-4b 逆参照ガードを通過させる）。
    mockMessage.findMany.mockResolvedValue([]);
    mockTransaction.mockImplementation(async (queries: unknown[]) => {
      if (!Array.isArray(queries)) return queries;
      return queries.map(() => ({ id: "deleted" }));
    });
  });

  it("単発メッセージ (next_message_id=null) は 1 件のみ削除する", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique.mockResolvedValueOnce({
      id: "m1", workId: "w1", phaseId: "p1", nextMessageId: null,
      work: { oaId: "oa1" }, phase: { phaseType: "normal" },
    });
    mockMessage.delete.mockImplementation((args: { where: { id: string } }) => args);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never);
    expect((res as Response).status).toBe(204);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const deletedIds = mockMessage.delete.mock.calls.map((c: { where: { id: string } }[]) => c[0].where.id);
    expect(deletedIds).toEqual(["m1"]);
  });

  it("chain head 削除時に continuation も一括削除する (msg1 → msg2 → msg3)", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    // findUnique の応答順: head → next → next-next → null
    mockMessage.findUnique
      .mockResolvedValueOnce({
        id: "m1", workId: "w1", phaseId: "p1", nextMessageId: "m2",
        work: { oaId: "oa1" }, phase: { phaseType: "normal" },
      })
      .mockResolvedValueOnce({ id: "m2", workId: "w1", nextMessageId: "m3" })
      .mockResolvedValueOnce({ id: "m3", workId: "w1", nextMessageId: null });
    mockMessage.delete.mockImplementation((args: { where: { id: string } }) => args);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never);
    expect((res as Response).status).toBe(204);

    const deletedIds = mockMessage.delete.mock.calls.map((c: { where: { id: string } }[]) => c[0].where.id);
    expect(deletedIds).toEqual(["m1", "m2", "m3"]);
  });

  it("循環参照 (m1 → m2 → m1) で無限ループしない", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique
      .mockResolvedValueOnce({
        id: "m1", workId: "w1", phaseId: "p1", nextMessageId: "m2",
        work: { oaId: "oa1" }, phase: { phaseType: "normal" },
      })
      .mockResolvedValueOnce({ id: "m2", workId: "w1", nextMessageId: "m1" });  // 循環
    mockMessage.delete.mockImplementation((args: { where: { id: string } }) => args);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never);
    expect((res as Response).status).toBe(204);

    const deletedIds = mockMessage.delete.mock.calls.map((c: { where: { id: string } }[]) => c[0].where.id);
    // m1 と m2 は削除されるが、m1 を再度追加しない (= visited set で停止)
    expect(deletedIds).toEqual(["m1", "m2"]);
  });

  it("別 work の message を next_message_id で参照していても跨いで削除しない", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique
      .mockResolvedValueOnce({
        id: "m1", workId: "w1", phaseId: "p1", nextMessageId: "m-other",
        work: { oaId: "oa1" }, phase: { phaseType: "normal" },
      })
      .mockResolvedValueOnce({ id: "m-other", workId: "w-other", nextMessageId: null });  // 別 work
    mockMessage.delete.mockImplementation((args: { where: { id: string } }) => args);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    await DELETE(makeReq() as never, { params: { id: "m1" } } as never);

    const deletedIds = mockMessage.delete.mock.calls.map((c: { where: { id: string } }[]) => c[0].where.id);
    expect(deletedIds).toEqual(["m1"]);  // = 別 work は walk 対象外
  });

  it("next_message_id が存在しない ID を指していたら walk 終了", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique
      .mockResolvedValueOnce({
        id: "m1", workId: "w1", phaseId: "p1", nextMessageId: "ghost",
        work: { oaId: "oa1" }, phase: { phaseType: "normal" },
      })
      .mockResolvedValueOnce(null);  // ghost は見つからない
    mockMessage.delete.mockImplementation((args: { where: { id: string } }) => args);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    await DELETE(makeReq() as never, { params: { id: "m1" } } as never);

    const deletedIds = mockMessage.delete.mock.calls.map((c: { where: { id: string } }[]) => c[0].where.id);
    expect(deletedIds).toEqual(["m1"]);
  });

  it("認可: editor 未満なら 403 を返し、削除は走らない（削除は editor 以上）", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ success: false }), { status: 403 }),
    });
    mockMessage.findUnique.mockResolvedValueOnce({
      id: "m1", workId: "w1", phaseId: "p1", nextMessageId: null,
      work: { oaId: "oa1" }, phase: { phaseType: "normal" },
    });

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never);
    expect((res as Response).status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith("oa1", "user-1", "editor");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("存在しない message_id は 404 を返す", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique.mockResolvedValueOnce(null);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "missing" } } as never);
    expect((res as Response).status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── #6-4b: 逆参照ガード ──────────────────────────────────
  it("外部参照なしなら従来通り削除できる（findMany=[]）", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique.mockResolvedValueOnce({
      id: "m1", workId: "w1", phaseId: "p1", nextMessageId: null,
      work: { oaId: "oa1" }, phase: { phaseType: "normal" },
    });
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", body: "", messageType: "text", nextMessageId: null, freeInputNextMessageId: null, quickReplies: null },
      { id: "x", body: "", messageType: "text", nextMessageId: null, freeInputNextMessageId: null, quickReplies: null },
    ]);
    mockMessage.delete.mockImplementation((args: { where: { id: string } }) => args);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never);
    expect((res as Response).status).toBe(204);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("対象メッセージへの外部参照ありなら 422（REFERENCE_GUARD）＋参照元一覧", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique.mockResolvedValueOnce({
      id: "m1", workId: "w1", phaseId: "p1", nextMessageId: null,
      work: { oaId: "oa1" }, phase: { phaseType: "normal" },
    });
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", body: "本体", messageType: "text", nextMessageId: null, freeInputNextMessageId: null, quickReplies: null },
      { id: "x", body: "参照元", messageType: "text", nextMessageId: "m1", freeInputNextMessageId: null, quickReplies: null },
    ]);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never) as Response;
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("REFERENCE_GUARD");
    expect(json.error.details.referrers).toHaveLength(1);
    expect(json.error.details.referrers[0]).toMatchObject({ referrerId: "x", kind: "next" });
    expect(json.error.details.referrers[0].kindLabel).toContain("連続");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("後続メッセージへの外部参照ありなら 422（m1→m2 削除予定 / x→m2）", async () => {
    mockRequireRole.mockResolvedValue(okRole());
    mockMessage.findUnique
      .mockResolvedValueOnce({
        id: "m1", workId: "w1", phaseId: "p1", nextMessageId: "m2",
        work: { oaId: "oa1" }, phase: { phaseType: "normal" },
      })
      .mockResolvedValueOnce({ id: "m2", workId: "w1", nextMessageId: null });
    mockMessage.findMany.mockResolvedValue([
      { id: "m1", body: "", messageType: "text", nextMessageId: "m2", freeInputNextMessageId: null, quickReplies: null },
      { id: "m2", body: "後続", messageType: "text", nextMessageId: null, freeInputNextMessageId: null, quickReplies: null },
      { id: "x", body: "外部", messageType: "text", nextMessageId: null, freeInputNextMessageId: null, quickReplies: JSON.stringify([{ target_message_id: "m2" }]) },
    ]);

    const { DELETE } = await import("@/app/api/messages/[id]/route");
    const res = await DELETE(makeReq() as never, { params: { id: "m1" } } as never) as Response;
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.details.referrers[0]).toMatchObject({ referrerId: "x", kind: "qr_target", targetId: "m2" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
