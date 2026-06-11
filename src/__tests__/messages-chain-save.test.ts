/**
 * src/__tests__/messages-chain-save.test.ts
 *
 * PUT /api/messages/chain（連続メッセージ一括保存）のユニットテスト。
 *
 * 検証:
 *  1. 認可: 権限なしは 403 / 削除を含むと owner 要求
 *  2. cross-work / head 不一致: 400 / 404
 *  3. 楽観ロック: expected_head_updated_at 不一致 → 409
 *  4. ドメイン検証: 複数 freeInput / 参照されている削除 → 422
 *  5. 正常系: send chain が next で連結 + freeInput 正規化 + chain/sendCount 返却
 *  6. transaction 途中失敗 → 500（rollback は $transaction 契約）
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

// ── prisma モック ───────────────────────────────────────
const mockMessage = {
  findMany:   vi.fn(),
  findUnique: vi.fn(),
  update:     vi.fn(),
  create:     vi.fn(),
  deleteMany: vi.fn(),
};
// $transaction(callback) 形式: tx クライアントを渡して実行
const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({ message: mockMessage }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message:      mockMessage,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => handler(req, ctx, { id: "user-1" }),
}));

const mockRequireRole       = vi.fn();
const mockGetOaIdFromWorkId = vi.fn(async (..._args: unknown[]) => "oa-1" as string | null);
vi.mock("@/lib/rbac", () => ({
  requireRole:       (...args: unknown[]) => mockRequireRole(...args),
  getOaIdFromWorkId: (...args: unknown[]) => mockGetOaIdFromWorkId(...args),
}));

vi.mock("@/lib/cache", () => ({
  activeCache: { delete: vi.fn(async () => {}) },
  CACHE_KEY: { phase: (id: string) => `phase:${id}`, startMsgs: (id: string) => `startMsgs:${id}`, globalKw: (id: string) => `globalKw:${id}` },
}));

// route は動的 import（vi.mock のホイスト前に prisma を import しないため）
let PUT: (req: Request, ctx: { params: Record<string, never> }) => Promise<Response>;
beforeAll(async () => {
  ({ PUT } = (await import("@/app/api/messages/chain/route")) as unknown as { PUT: typeof PUT });
});

const WORK = "11111111-1111-1111-1111-111111111111";
const HEAD = "22222222-2222-2222-2222-222222222222";
const S1   = "33333333-3333-3333-3333-333333333333";
const S2   = "44444444-4444-4444-4444-444444444444";
const RESP = "55555555-5555-5555-5555-555555555555";
const OUT  = "66666666-6666-6666-6666-666666666666";

function req(body: unknown): Request {
  return new Request("http://t/api/messages/chain", { method: "PUT", body: JSON.stringify(body) });
}
const ctx = { params: {} as Record<string, never> };

// work findMany が返す既存メッセージ集合
function setWork(msgs: Array<Record<string, unknown>>) {
  // 1回目: work 全件 / 2回目以降: 保存後の再fetch / findUnique: head phase
  mockMessage.findMany.mockReset();
  mockMessage.findMany
    .mockResolvedValueOnce(msgs)              // work（ガード用）
    .mockResolvedValue(msgs);                 // 再fetch（後で上書き可）
  mockMessage.findUnique.mockResolvedValue({ phaseId: "ph-1", phase: { phaseType: "normal" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ ok: true, role: "owner", status: "active" });
  mockGetOaIdFromWorkId.mockResolvedValue("oa-1");
  mockMessage.update.mockResolvedValue({});
  mockMessage.create.mockResolvedValue({ id: "new-created" });
  mockMessage.deleteMany.mockResolvedValue({ count: 0 });
});

describe("PUT /api/messages/chain", () => {
  it("権限なしは 403", async () => {
    setWork([{ id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() }]);
    mockRequireRole.mockResolvedValue({ ok: false, response: new Response("forbidden", { status: 403 }) });
    const res = await PUT(req({ work_id: WORK, head_id: HEAD, slots: [] }), ctx);
    expect((res as Response).status).toBe(403);
  });

  it("削除を含む場合は owner 権限を要求する", async () => {
    setWork([
      { id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() },
      { id: S1, phaseId: "ph-1", sortOrder: 1, nextMessageId: null, updatedAt: new Date() },
    ]);
    await PUT(req({ work_id: WORK, head_id: HEAD, slots: [], removed_message_ids: [S1] }), ctx);
    expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", "owner");
  });

  it("内容更新のみは tester 権限", async () => {
    setWork([{ id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() }]);
    await PUT(req({ work_id: WORK, head_id: HEAD, slots: [] }), ctx);
    expect(mockRequireRole).toHaveBeenCalledWith("oa-1", "user-1", "tester");
  });

  it("head が work に存在しなければ 404", async () => {
    setWork([{ id: S1, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() }]);
    const res = await PUT(req({ work_id: WORK, head_id: HEAD, slots: [] }), ctx);
    expect((res as Response).status).toBe(404);
  });

  it("slot id が work に属さなければ 400（cross-work 防御）", async () => {
    setWork([{ id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() }]);
    const res = await PUT(req({ work_id: WORK, head_id: HEAD, slots: [{ id: OUT }] }), ctx);
    expect((res as Response).status).toBe(400);
  });

  it("expected_head_updated_at 不一致は 409", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    setWork([{ id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: now }]);
    const res = await PUT(req({ work_id: WORK, head_id: HEAD, slots: [], expected_head_updated_at: "2026-05-01T00:00:00.000Z" }), ctx);
    expect((res as Response).status).toBe(409);
  });

  it("複数 freeInput は 422", async () => {
    setWork([
      { id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: S1, updatedAt: new Date() },
      { id: S1, phaseId: "ph-1", sortOrder: 1, nextMessageId: null, updatedAt: new Date() },
    ]);
    const res = await PUT(req({
      work_id: WORK, head_id: HEAD, head: { free_input_enabled: true },
      slots: [{ id: S1, free_input_enabled: true }],
    }), ctx);
    expect((res as Response).status).toBe(422);
  });

  it("削除対象が chain 外から参照されていれば 422", async () => {
    setWork([
      { id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() },
      { id: S1, phaseId: "ph-1", sortOrder: 1, nextMessageId: null, updatedAt: new Date() },
      { id: OUT, phaseId: "ph-1", sortOrder: 2, nextMessageId: S1, updatedAt: new Date() }, // 外から S1 を参照
    ]);
    const res = await PUT(req({ work_id: WORK, head_id: HEAD, slots: [], removed_message_ids: [S1] }), ctx);
    expect((res as Response).status).toBe(422);
  });

  it("正常系: send chain を next で連結し、freeInput を正規化して保存・chain/sendCount を返す", async () => {
    setWork([
      { id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: S1, updatedAt: new Date() },
      { id: S1, phaseId: "ph-1", sortOrder: 1, nextMessageId: S2, updatedAt: new Date() },
      { id: S2, phaseId: "ph-1", sortOrder: 2, nextMessageId: null, updatedAt: new Date() },
      { id: RESP, phaseId: "ph-1", sortOrder: 3, nextMessageId: null, updatedAt: new Date() },
    ]);
    // 再fetch（chain walk 用）
    mockMessage.findMany
      .mockReset()
      .mockResolvedValueOnce([
        { id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: S1, freeInputNextMessageId: null, quickReplies: null, updatedAt: new Date() },
        { id: S1, phaseId: "ph-1", sortOrder: 1, nextMessageId: S2, freeInputNextMessageId: null, quickReplies: null, updatedAt: new Date() },
        { id: S2, phaseId: "ph-1", sortOrder: 2, nextMessageId: null, freeInputNextMessageId: null, quickReplies: null, updatedAt: new Date() },
        { id: RESP, phaseId: "ph-1", sortOrder: 3, nextMessageId: null, freeInputNextMessageId: null, quickReplies: null, updatedAt: new Date() },
      ])
      .mockResolvedValue([
        { id: HEAD, nextMessageId: S1 },
        { id: S1, nextMessageId: S2 },
        { id: S2, nextMessageId: null },
      ]);

    const res = await PUT(req({
      work_id: WORK, head_id: HEAD,
      head: { body: "1通目" },
      slots: [{ id: S1, body: "2通目" }, { id: S2, body: "3通目(自由入力)", free_input_enabled: true }],
      free_input_response_id: RESP,
    }), ctx) as Response;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.sendCount).toBe(3);
    expect(json.data.exceedsReplyLimit).toBe(false);
    expect(json.data.freeInputResponseId).toBe(RESP);
    expect(json.data.chain.map((m: { id: string }) => m.id)).toEqual([HEAD, S1, S2]);

    // リンク: HEAD.next=S1, S1.next=S2, S2(freeInput).next=null + freeInputNext=RESP
    const updates = Object.fromEntries(
      mockMessage.update.mock.calls.map((c) => [c[0].where.id, c[0].data]),
    );
    expect(updates[HEAD].nextMessageId).toBe(S1);
    expect(updates[HEAD].freeInputEnabled).toBe(false);
    expect(updates[HEAD].freeInputNextMessageId).toBe(null);
    expect(updates[S1].nextMessageId).toBe(S2);
    expect(updates[S2].nextMessageId).toBe(null);
    expect(updates[S2].freeInputEnabled).toBe(true);
    expect(updates[S2].freeInputNextMessageId).toBe(RESP);
  });

  it("新規スロット(id なし)は create され、確定 id でリンクされる", async () => {
    setWork([{ id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() }]);
    mockMessage.create.mockResolvedValue({ id: "created-1" });
    mockMessage.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: null, updatedAt: new Date() }])
      .mockResolvedValue([{ id: HEAD, nextMessageId: "created-1" }, { id: "created-1", nextMessageId: null }]);

    const res = await PUT(req({ work_id: WORK, head_id: HEAD, head: { body: "1" }, slots: [{ body: "新規2通目" }] }), ctx) as Response;
    expect(res.status).toBe(200);
    expect(mockMessage.create).toHaveBeenCalledTimes(1);
    const updates = Object.fromEntries(mockMessage.update.mock.calls.map((c) => [c[0].where.id, c[0].data]));
    expect(updates[HEAD].nextMessageId).toBe("created-1");
    expect(updates["created-1"].nextMessageId).toBe(null);
  });

  it("transaction 途中失敗は 500（部分反映させない）", async () => {
    setWork([
      { id: HEAD, phaseId: "ph-1", sortOrder: 0, nextMessageId: S1, updatedAt: new Date() },
      { id: S1, phaseId: "ph-1", sortOrder: 1, nextMessageId: null, updatedAt: new Date() },
    ]);
    mockMessage.update.mockRejectedValueOnce(new Error("db down"));
    const res = await PUT(req({ work_id: WORK, head_id: HEAD, head: { body: "x" }, slots: [{ id: S1, body: "y" }] }), ctx) as Response;
    expect(res.status).toBe(500);
  });
});
