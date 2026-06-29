/**
 * src/__tests__/works-start-keyword-validation.test.ts
 *
 * PATCH /api/works/[workId] の start_keyword 保存 + 重複バリデーションを検証する（prisma mock）。
 *
 * 仕様:
 *  - 公開中（になる）作品が start_keyword を持つ場合、同一 OA の他の公開中作品の
 *    開始キーワード候補（startKeyword ∨ 開始フェーズ startTrigger）と重複したら 400。
 *  - 重複がなければ 200、startKeyword を保存（空文字は null に正規化）。
 *  - 別 OA の作品とは衝突しても良い（重複検索は oaId スコープ）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockWork  = { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() };
const mockPhase = { findFirst: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { work: mockWork, phase: mockPhase } }));

vi.mock("@/lib/auth", () => ({
  withAuth: <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => handler(req, ctx, { id: "user-1" }),
}));
const mockRequireRole = vi.fn(async (..._args: unknown[]) => ({ ok: true, response: null }));
vi.mock("@/lib/rbac", () => ({ requireRole: (...args: unknown[]) => mockRequireRole(...args) }));
vi.mock("@/lib/cache", () => ({
  activeCache: { delete: vi.fn(async () => {}) },
  CACHE_KEY: { work: (id: string) => `work:${id}` },
}));

const WORK_ID = "w1", OA_ID = "oa1";
function existingWork(over: Record<string, unknown> = {}) {
  return {
    id: WORK_ID, publicId: null, oaId: OA_ID, title: "作品", description: null,
    publishStatus: "active", sortOrder: 0, liffEnabled: true, liffHomeSettingsJson: {},
    resumeEnabled: true, systemCharacterId: null,
    welcomeMessage: null, welcomeMessagesJson: [], welcomeLoadingSeconds: 0, followAction: "auto_start",
    startKeyword: null,
    readReceiptMode: null, readDelayMs: null, typingEnabled: null, typingMinMs: null, typingMaxMs: null,
    loadingEnabled: null, loadingThresholdMs: null, loadingMinSeconds: null, loadingMaxSeconds: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}
async function callPatch(body: unknown, workId = WORK_ID) {
  const { PATCH } = await import("@/app/api/works/[workId]/route");
  const req = new Request(`http://localhost/api/works/${workId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return PATCH(req as Parameters<typeof PATCH>[0], { params: { workId } });
}
function savedData() {
  return mockWork.update.mock.calls[0]?.[0]?.data as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ ok: true, response: null });
  mockWork.findUnique.mockResolvedValue(existingWork());
  mockWork.findMany.mockResolvedValue([]);              // 他の公開中作品なし（デフォルト）
  mockPhase.findFirst.mockResolvedValue(null);          // 他作品の startTrigger なし（デフォルト）
  mockWork.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => existingWork(data));
});

describe("start_keyword 重複バリデーション", () => {
  it("同一OAの他公開中作品の startKeyword と重複 → 400", async () => {
    mockWork.findMany.mockResolvedValue([{ id: "w2", startKeyword: "森の手紙" }]);
    const res = await callPatch({ start_keyword: "森の手紙" });
    expect(res.status).toBe(400);
    expect(mockWork.update).not.toHaveBeenCalled();
  });

  it("同一OAの他公開中作品の startTrigger と重複 → 400", async () => {
    mockWork.findMany.mockResolvedValue([{ id: "w2", startKeyword: null }]);
    mockPhase.findFirst.mockResolvedValue({ startTrigger: "はじめる" }); // w2 の開始フェーズ
    const res = await callPatch({ start_keyword: "はじめる" });
    expect(res.status).toBe(400);
  });

  it("正規化後の重複（全角/前後スペース）も検出 → 400", async () => {
    mockWork.findMany.mockResolvedValue([{ id: "w2", startKeyword: "start" }]);
    const res = await callPatch({ start_keyword: "  ＳＴＡＲＴ " });
    expect(res.status).toBe(400);
  });

  it("重複なし → 200、startKeyword を保存", async () => {
    mockWork.findMany.mockResolvedValue([{ id: "w2", startKeyword: "別キーワード" }]);
    const res = await callPatch({ start_keyword: "森の手紙" });
    expect(res.status).toBe(200);
    expect(savedData()?.startKeyword).toBe("森の手紙");
  });

  it("空文字は null に正規化して保存（重複チェック対象外）", async () => {
    const res = await callPatch({ start_keyword: "" });
    expect(res.status).toBe(200);
    expect(savedData()?.startKeyword).toBeNull();
  });

  it("重複検索は同一 OA スコープ（別 OA とは衝突しない）", async () => {
    await callPatch({ start_keyword: "森の手紙" });
    const findManyArg = mockWork.findMany.mock.calls[0]?.[0];
    expect(findManyArg?.where?.oaId).toBe(OA_ID);
    expect(findManyArg?.where?.publishStatus).toBe("active");
    expect(findManyArg?.where?.id).toEqual({ not: WORK_ID });
  });
});
