/**
 * src/__tests__/works-welcome-messages.test.ts
 *
 * PR-G2-B1: PATCH /api/works/[workId] の welcome_messages 保存 + validation、
 * および GET / 保存応答の welcome_messages 返却を検証する（API ユニット・prisma mock）。
 *
 * 保存仕様（案B）:
 *  - welcome_messages !== undefined のときだけ welcomeMessagesJson に保存。
 *  - welcomeMessage = 先頭 text item の text ?? null（同期/空化）。
 *  - validation 失敗は 400（badRequest。全フィールド共通）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── モック ──
const mockWork = { findUnique: vi.fn(), update: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { work: mockWork } }));

vi.mock("@/lib/auth", () => ({
  withAuth: <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => handler(req, ctx, { id: "user-1" }),
}));

const mockRequireRole = vi.fn(async (..._args: unknown[]) => ({ ok: true, response: null }));
vi.mock("@/lib/rbac", () => ({ requireRole: (...args: unknown[]) => mockRequireRole(...args) }));

const mockCacheDelete = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/cache", () => ({
  activeCache: { delete: (...args: unknown[]) => mockCacheDelete(...args) },
  CACHE_KEY: { work: (id: string) => `work:${id}` },
}));

// validations / welcome-messages / api-response / perf / liff-style-helpers は実物を使う（真の検証・整形）。

const WORK_ID = "w1", OA_ID = "oa1";
function existingWork(over: Record<string, unknown> = {}) {
  return {
    id: WORK_ID, publicId: null, oaId: OA_ID, title: "作品", description: null,
    publishStatus: "active", sortOrder: 0, liffEnabled: true, liffHomeSettingsJson: {},
    resumeEnabled: true, systemCharacterId: null,
    welcomeMessage: "旧本文", welcomeMessagesJson: [], followAction: "welcome_wait",
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
/** PATCH 後に prisma.work.update に渡された data を返す */
function savedData() {
  return mockWork.update.mock.calls[0]?.[0]?.data as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ ok: true, response: null });
  mockWork.findUnique.mockResolvedValue(existingWork());
  // update は data をマージした行を返す（toResponse が整形できるように）
  mockWork.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => existingWork(data));
});

describe("PATCH welcome_messages — 正常系", () => {
  it("text 1件 → welcomeMessagesJson 保存 + welcomeMessage 同期、応答に welcome_messages", async () => {
    const res = await callPatch({ welcome_messages: [{ type: "text", text: "やあ" }] });
    expect(res.status).toBe(200);
    const d = savedData()!;
    expect(d.welcomeMessagesJson).toEqual([{ type: "text", text: "やあ" }]);
    expect(d.welcomeMessage).toBe("やあ");                 // 先頭 text 同期
    const body = await res.json();
    expect(body.data.welcome_messages).toEqual([{ type: "text", text: "やあ" }]);
    expect(body.data.welcome_message).toBe("やあ");        // 互換も返る
  });

  it("text 複数件 → 全件保存、welcomeMessage は先頭 text", async () => {
    const res = await callPatch({ welcome_messages: [
      { type: "text", text: "1通目" }, { type: "text", text: "2通目" },
    ] });
    expect(res.status).toBe(200);
    const d = savedData()!;
    expect(d.welcomeMessagesJson).toHaveLength(2);
    expect(d.welcomeMessage).toBe("1通目");
  });

  it("image 1件 → 保存され welcomeMessage=null（text 無し）", async () => {
    const res = await callPatch({ welcome_messages: [{ type: "image", imageUrl: "https://ex.com/a.png" }] });
    expect(res.status).toBe(200);
    const d = savedData()!;
    expect(d.welcomeMessagesJson).toEqual([{ type: "image", imageUrl: "https://ex.com/a.png" }]);
    expect(d.welcomeMessage).toBeNull();
  });

  it("text + image 混在 → 順序保持、welcomeMessage は先頭 text", async () => {
    const res = await callPatch({ welcome_messages: [
      { type: "text", text: "やあ" }, { type: "image", imageUrl: "https://ex.com/a.png" },
    ] });
    expect(res.status).toBe(200);
    const d = savedData()!;
    expect((d.welcomeMessagesJson as unknown[])).toHaveLength(2);
    expect(d.welcomeMessage).toBe("やあ");
  });

  it("5件 → 保存OK", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ type: "text", text: `t${i + 1}` }));
    const res = await callPatch({ welcome_messages: five });
    expect(res.status).toBe(200);
    expect((savedData()!.welcomeMessagesJson as unknown[])).toHaveLength(5);
  });

  it("空配列 → welcomeMessagesJson=[] かつ welcomeMessage=null（全削除）", async () => {
    const res = await callPatch({ welcome_messages: [] });
    expect(res.status).toBe(200);
    const d = savedData()!;
    expect(d.welcomeMessagesJson).toEqual([]);
    expect(d.welcomeMessage).toBeNull();
  });

  it("welcome_messages 省略時は welcomeMessagesJson / welcomeMessage を変更しない", async () => {
    const res = await callPatch({ follow_action: "none" });
    expect(res.status).toBe(200);
    const d = savedData()!;
    expect("welcomeMessagesJson" in d).toBe(false);
    expect("welcomeMessage" in d).toBe(false);
    expect(d.followAction).toBe("none");
  });
});

describe("PATCH welcome_messages — validation 400", () => {
  it("6件 → 400、update 呼ばれない", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "text", text: `t${i + 1}` }));
    const res = await callPatch({ welcome_messages: six });
    expect(res.status).toBe(400);
    expect(mockWork.update).not.toHaveBeenCalled();
  });

  it("空 text → 400", async () => {
    const res = await callPatch({ welcome_messages: [{ type: "text", text: "   " }] });
    expect(res.status).toBe(400);
  });

  it("http 画像URL → 400", async () => {
    const res = await callPatch({ welcome_messages: [{ type: "image", imageUrl: "http://ex.com/a.png" }] });
    expect(res.status).toBe(400);
  });

  it("imageUrl 欠落 → 400", async () => {
    const res = await callPatch({ welcome_messages: [{ type: "image" }] });
    expect(res.status).toBe(400);
  });

  it("unknown type → 400", async () => {
    const res = await callPatch({ welcome_messages: [{ type: "flex", text: "x" }] });
    expect(res.status).toBe(400);
  });
});

describe("GET — welcome_messages と welcome_message を返す", () => {
  it("welcomeMessagesJson から welcome_messages、welcomeMessage も返る", async () => {
    mockWork.findUnique.mockResolvedValue(existingWork({
      welcomeMessage: "互換本文",
      welcomeMessagesJson: [{ type: "text", text: "あいさつ1" }, { type: "image", imageUrl: "https://ex.com/a.png" }],
      _count: { characters: 0, phases: 0, messages: 0, userProgress: 0 },
    }));
    const { GET } = await import("@/app/api/works/[workId]/route");
    const req = new Request(`http://localhost/api/works/${WORK_ID}`, { method: "GET" });
    const res = await GET(req as Parameters<typeof GET>[0], { params: { workId: WORK_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.welcome_messages).toEqual([
      { type: "text", text: "あいさつ1" }, { type: "image", imageUrl: "https://ex.com/a.png" },
    ]);
    expect(body.data.welcome_message).toBe("互換本文");
  });
});
