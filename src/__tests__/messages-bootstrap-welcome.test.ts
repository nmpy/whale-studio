/**
 * src/__tests__/messages-bootstrap-welcome.test.ts
 *
 * PR-G2-B2 回帰: メッセージ画面 bootstrap GET が work.welcome_messages を返すこと。
 * （以前は welcomeMessagesJson を select / 整形しておらず、保存後リロードで複数あいさつが
 *  旧 welcome_message の先頭 text に縮退して消える不具合があった。）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockWork = { findUnique: vi.fn() };
const mockMessage = { findMany: vi.fn() };
const mockPhase = { findMany: vi.fn() };
const mockTransition = { findMany: vi.fn() };
vi.mock("@/lib/prisma", () => ({
  prisma: { work: mockWork, message: mockMessage, phase: mockPhase, transition: mockTransition },
}));

vi.mock("@/lib/auth", () => ({
  withAuth: <P>(handler: (req: Request, ctx: { params: P }, user: { id: string }) => Promise<unknown>) =>
    (req: Request, ctx: { params: P }) => handler(req, ctx, { id: "user-1" }),
}));

vi.mock("@/lib/rbac", () => ({
  requireRole: vi.fn(async () => ({ ok: true, response: null, role: "owner" })),
  roleAtLeast: () => true,
}));

vi.mock("@/lib/oa-cache", () => ({
  getCachedOaById: vi.fn(async () => ({ ownerKey: "owner-1" })),
}));

// perf / api-response / list-shapes / welcome-messages は実物（純粋）を使う。

const OA = "oa1", WORK = "w1";
function makeWork(over: Record<string, unknown> = {}) {
  return {
    id: WORK, oaId: OA, title: "作品", welcomeMessage: "旧本文", welcomeMessagesJson: [],
    followAction: "welcome_wait", publishStatus: "active", liffEnabled: true,
    resumeEnabled: true, systemCharacterId: null, ...over,
  };
}

async function callGet(id = OA, workId = WORK) {
  const { GET } = await import("@/app/api/oas/[id]/works/[workId]/messages/bootstrap/route");
  const req = new Request(`http://localhost/api/oas/${id}/works/${workId}/messages/bootstrap`);
  return GET(req as Parameters<typeof GET>[0], { params: { id, workId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMessage.findMany.mockResolvedValue([]);
  mockPhase.findMany.mockResolvedValue([]);
  mockTransition.findMany.mockResolvedValue([]);
});

describe("messages bootstrap GET — welcome_messages 返却", () => {
  it("welcomeMessagesJson の複数 item を welcome_messages として返す（welcome_message も返る）", async () => {
    mockWork.findUnique.mockResolvedValue(makeWork({
      welcomeMessage: "やあ",
      welcomeMessagesJson: [
        { type: "text", text: "やあ" },
        { type: "image", imageUrl: "https://ex.com/a.png" },
        { type: "text", text: "3通目" },
      ],
    }));
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.work.welcome_messages).toEqual([
      { type: "text", text: "やあ" },
      { type: "image", imageUrl: "https://ex.com/a.png" },
      { type: "text", text: "3通目" },
    ]);
    expect(body.data.work.welcome_message).toBe("やあ");
  });

  it("全削除相当（welcomeMessagesJson=[] / welcomeMessage=null）→ welcome_messages は []", async () => {
    mockWork.findUnique.mockResolvedValue(makeWork({ welcomeMessagesJson: [], welcomeMessage: null }));
    const res = await callGet();
    const body = await res.json();
    expect(body.data.work.welcome_messages).toEqual([]);
    expect(body.data.work.welcome_message).toBeNull();
  });

  it("不正/未設定の welcomeMessagesJson → welcome_messages は []（throw しない）", async () => {
    mockWork.findUnique.mockResolvedValue(makeWork({ welcomeMessagesJson: null }));
    const res = await callGet();
    const body = await res.json();
    expect(body.data.work.welcome_messages).toEqual([]);
  });

  it("welcome_loading_seconds が返る（PR-B1）", async () => {
    mockWork.findUnique.mockResolvedValue(makeWork({ welcomeLoadingSeconds: 4 }));
    const res = await callGet();
    const body = await res.json();
    expect(body.data.work.welcome_loading_seconds).toBe(4);
  });
  it("welcomeLoadingSeconds 未設定 → welcome_loading_seconds は 0", async () => {
    mockWork.findUnique.mockResolvedValue(makeWork({}));
    const res = await callGet();
    const body = await res.json();
    expect(body.data.work.welcome_loading_seconds).toBe(0);
  });
});
