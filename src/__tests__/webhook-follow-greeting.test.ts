/**
 * src/__tests__/webhook-follow-greeting.test.ts
 *
 * PR-G1: あいさつメッセージの固定「はじめる」案内を廃止し、対象作品の startTrigger を
 * message-action quick reply として付与する挙動を検証する。
 *
 * 検証:
 *  - welcome_wait + welcomeMessage + startTrigger あり → あいさつ1件 + 末尾に startTrigger QR、固定「はじめる」なし
 *  - startTrigger = "はじめる" → QR の label/text が "はじめる"（既存互換）
 *  - welcome_wait + welcomeMessage + startTrigger 未設定 → あいさつのみ、QR なし、固定「はじめる」なし
 *  - welcomeMessage 未設定 → 送信しない（既存方針維持）
 *  - followAction = "none" → 送信しない
 *  - followAction = "auto_start" → 既存どおり handleStart（progress 作成）、あいさつ送信ではない
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  oa:            { findFirst: vi.fn() },
  work:          { findFirst: vi.fn(), findMany: vi.fn() },
  richMenu:      { findFirst: vi.fn() },
  phase:         { findFirst: vi.fn(), findUnique: vi.fn() },
  userProgress:  { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
  message:       { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  globalCommand: { findMany: vi.fn() },
  tracking:      { findMany: vi.fn() },
  trackingEvent: { findFirst: vi.fn() },
  userTracking:  { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// activeCache always-miss（getCachedStartPhase が per-test の phase.findFirst を使うように）
vi.mock("@/lib/cache", () => ({
  activeCache: {
    get:    vi.fn().mockResolvedValue(null),
    set:    vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  TTL: { OA: 0, WORK: 0, PHASE: 0, PROGRESS: 0, GLOBAL_CMD: 0, GLOBAL_KW: 0, START_PHASE: 0, START_MSGS: 0 },
  CACHE_KEY: {
    oa: (x: string) => `oa:${x}`, work: (x: string) => `work:${x}`, phase: (x: string) => `phase:${x}`,
    progress: (u: string, w: string) => `progress:${u}:${w}`, globalCmd: (x: string) => `gc:${x}`,
    globalKw: (x: string) => `gk:${x}`, startPhase: (x: string) => `sp:${x}`, startMsgs: (x: string) => `sm:${x}`,
  },
}));
vi.mock("@/lib/event-logger", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

const mockReplyToLine        = vi.fn().mockResolvedValue(undefined);
const mockReplyWithLagToLine = vi.fn().mockResolvedValue(undefined);
const mockPushToLine         = vi.fn().mockResolvedValue(undefined);
const mockSleep              = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/line", () => ({
  verifyLineSignature:    vi.fn().mockReturnValue(true),
  isStartCommand:         vi.fn().mockReturnValue(false),
  isStartIntent:          vi.fn().mockReturnValue(false),
  isResetCommand:         vi.fn().mockReturnValue(false),
  isContinueCommand:      vi.fn().mockReturnValue(false),
  replyToLine:            mockReplyToLine,
  replyWithLagToLine:     mockReplyWithLagToLine,
  buildPhaseMessages:     vi.fn().mockReturnValue([{ type: "text", text: "phase-msg" }]),
  buildQuickReply:        vi.fn().mockReturnValue(undefined),
  buildQuickReplyFromItems: vi.fn().mockReturnValue(undefined),
  buildKeywordMessages:   vi.fn().mockReturnValue([{ type: "text", text: "kw-msg" }]),
  pushToLine:             mockPushToLine,
  sleep:                  (...a: unknown[]) => mockSleep(...a),
  resolveHeadSendDelayMs: vi.fn().mockReturnValue(0),
  RICHMENU_ACTIONS:       { START: "start", RESET: "reset", CONTINUE: "continue" },
}));

// あいさつ送信前の loading 演出（PR-B1）。showLoadingAnimation は stub（実 API を叩かない）。
const mockShowLoadingAnimation = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/line-read-receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line-read-receipt")>();
  return { ...actual, showLoadingAnimation: (...a: unknown[]) => mockShowLoadingAnimation(...a) };
});

vi.mock("@/lib/runtime", () => ({
  buildRuntimeState: vi.fn().mockResolvedValue({ phase: { id: "p1", messages: [], transitions: [] } }),
  matchTransition:   vi.fn().mockReturnValue(null),
  applySetFlags:     vi.fn().mockReturnValue({}),
  safeParseFlags:    vi.fn().mockReturnValue({}),
  safeParseVariables: vi.fn().mockReturnValue({}),
  safeParseWaitingForInput: vi.fn().mockReturnValue(null),
  fetchPhaseWithIncludes: vi.fn().mockResolvedValue(null),
  drainAutoSendableItems: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/line-richmenu", () => ({ linkRichMenuToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/sheets-db", () => ({ loadSheetsData: vi.fn(), findActiveWork: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/sheets-scenario", () => ({ handleTextEventSheets: vi.fn(), handlePostbackEventSheets: vi.fn(), buildSystemSenderFromSheets: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ requireRole: vi.fn(), getOaIdFromWorkId: vi.fn() }));

// ── フィクスチャ ──
const OA_ID = "oa-uuid-g1", WORK_ID = "work-uuid-g1", USER_ID = "U_follow_g1", START_PHASE_ID = "sp-g1";
const REPLY_TOKEN = "rtoken-g1";
const FIXED_HINT = "「はじめる」と送ってください。"; // 廃止された固定文言

function makeOa(over: Partial<{ welcomeMessage: string | null; followAction: string | null }> = {}) {
  return {
    id: OA_ID, title: "あいさつOA", lineOaId: "greetoa",
    channelId: "d", channelSecret: "s", channelAccessToken: "token", spreadsheetId: null,
    publishStatus: "active", serviceSuspendedAt: null,
    welcomeMessage: null, followAction: null, ...over,
  };
}
function makeWork(over: Partial<{ welcomeMessage: string | null; followAction: string; welcomeMessagesJson: unknown; welcomeLoadingSeconds: number }> = {}) {
  return {
    id: WORK_ID, title: "あいさつ作品", publishStatus: "active", sortOrder: 0,
    welcomeMessage: null, followAction: "auto_start", systemCharacter: null, welcomeMessagesJson: [], welcomeLoadingSeconds: 0, ...over,
  };
}
function makeStartPhase(startTrigger: string | null) {
  return { id: START_PHASE_ID, phaseType: "start", startTrigger, resumeSummary: null };
}

function makeFollowBody() {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "follow", replyToken: REPLY_TOKEN, source: { userId: USER_ID, type: "user" } }],
  });
}
async function callWebhook(lineOaId: string, body: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${lineOaId}/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-line-signature": "dummy" }, body,
  });
  return POST(req as Parameters<typeof POST>[0], { params: { oaId: lineOaId } });
}

/** あいさつ reply（REPLY_TOKEN への replyToLine 呼び出し）の messages を返す */
function welcomeReplyMessages(): any[] | null {
  const call = mockReplyToLine.mock.calls.find((c) => c[0] === REPLY_TOKEN);
  return call ? (call[1] as any[]) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.work.findMany.mockResolvedValue([]);
  mockPrisma.work.findFirst.mockResolvedValue(makeWork());
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(null);
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]);
  mockPrisma.userProgress.findUnique.mockResolvedValue(null);
  mockPrisma.userProgress.upsert.mockResolvedValue({ id: "prog-1", currentPhaseId: START_PHASE_ID, reachedEnding: false, flags: "{}" });
});

describe("PR-G1: follow あいさつ + startTrigger quick reply", () => {
  it("welcome_wait + welcomeMessage + startTrigger あり → あいさつ1件 + 末尾 startTrigger QR、固定「はじめる」なし", async () => {
    const oa = makeOa({ welcomeMessage: "ようこそ！", followAction: "welcome_wait" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockPrisma.phase.findFirst.mockResolvedValue(makeStartPhase("ぼうけんをはじめる"));

    await callWebhook(oa.lineOaId, makeFollowBody());

    const msgs = welcomeReplyMessages();
    expect(msgs).not.toBeNull();
    expect(msgs!).toHaveLength(1);                              // 固定「はじめる」吹き出しは無い
    expect(msgs![0].type).toBe("text");
    expect(msgs![0].text).toBe("ようこそ！");
    // 末尾メッセージに startTrigger の message-action quick reply
    expect(msgs![0].quickReply.items[0].action).toEqual({ type: "message", label: "ぼうけんをはじめる", text: "ぼうけんをはじめる" });
    // 固定文言を含むメッセージが無い
    expect(msgs!.some((m) => m.text === FIXED_HINT)).toBe(false);
  });

  it("startTrigger = 'はじめる' → QR label/text が 'はじめる'（既存互換）", async () => {
    const oa = makeOa({ welcomeMessage: "ようこそ！", followAction: "welcome_wait" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockPrisma.phase.findFirst.mockResolvedValue(makeStartPhase("はじめる"));

    await callWebhook(oa.lineOaId, makeFollowBody());

    const msgs = welcomeReplyMessages();
    expect(msgs![0].quickReply.items[0].action).toEqual({ type: "message", label: "はじめる", text: "はじめる" });
  });

  it("welcome_wait + welcomeMessage + startTrigger 未設定 → あいさつのみ、QR なし、固定「はじめる」なし", async () => {
    const oa = makeOa({ welcomeMessage: "ようこそ！", followAction: "welcome_wait" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockPrisma.phase.findFirst.mockResolvedValue(makeStartPhase(null)); // startTrigger 未設定

    await callWebhook(oa.lineOaId, makeFollowBody());

    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(1);
    expect(msgs![0].text).toBe("ようこそ！");
    expect(msgs![0].quickReply).toBeUndefined();               // QR なし（固定「はじめる」代用なし）
    expect(msgs!.some((m) => m.text === FIXED_HINT)).toBe(false);
  });

  it("welcomeMessage 未設定 → 送信しない（既存方針維持）", async () => {
    const oa = makeOa({ welcomeMessage: null, followAction: "welcome_wait" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockPrisma.work.findFirst.mockResolvedValue(makeWork({ welcomeMessage: null }));
    mockPrisma.phase.findFirst.mockResolvedValue(makeStartPhase("ぼうけん"));

    await callWebhook(oa.lineOaId, makeFollowBody());

    expect(welcomeReplyMessages()).toBeNull();                 // 何も送らない
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("followAction = 'none' → 送信しない", async () => {
    const oa = makeOa({ welcomeMessage: "ようこそ！", followAction: "none" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);

    await callWebhook(oa.lineOaId, makeFollowBody());

    expect(welcomeReplyMessages()).toBeNull();
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("followAction = 'auto_start'（開始フェーズあり）→ 既存どおり handleStart（progress 作成）であり、あいさつ送信ではない", async () => {
    const oa = makeOa({ welcomeMessage: "ようこそ！", followAction: "auto_start" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockPrisma.phase.findFirst.mockResolvedValue(makeStartPhase("ぼうけん")); // 開始フェーズあり

    await callWebhook(oa.lineOaId, makeFollowBody());

    // handleStart 経路（progress upsert）が走る＝既存 auto_start 挙動を壊していない
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
    // あいさつ本文（welcomeMessage）の reply ではない
    const msgs = welcomeReplyMessages();
    if (msgs) expect(msgs.some((m) => m.text === "ようこそ！")).toBe(false);
  });
});

// ─────────────────────────────────────────────
//  PR-G2-A: welcomeMessagesJson（複数件 text/image）
// ─────────────────────────────────────────────
describe("PR-G2-A: welcomeMessagesJson による複数あいさつ + 画像", () => {
  function setupWelcomeWait(over: Partial<{ welcomeMessage: string | null; welcomeMessagesJson: unknown; welcomeLoadingSeconds: number }>, startTrigger: string | null = "ぼうけん") {
    const oa = makeOa({ welcomeMessage: null, followAction: "welcome_wait" });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockPrisma.work.findFirst.mockResolvedValue(makeWork({ followAction: "welcome_wait", ...over }));
    mockPrisma.phase.findFirst.mockResolvedValue(makeStartPhase(startTrigger));
    return oa;
  }

  it("welcomeMessagesJson 空 + 既存 welcomeMessage あり → 既存と同じ 1件 text（互換）", async () => {
    const oa = setupWelcomeWait({ welcomeMessage: "ようこそ！", welcomeMessagesJson: [] });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(1);
    expect(msgs![0].type).toBe("text");
    expect(msgs![0].text).toBe("ようこそ！");
  });

  it("welcomeMessagesJson 空 + welcomeMessage なし → 無送信", async () => {
    const oa = setupWelcomeWait({ welcomeMessage: null, welcomeMessagesJson: [] });
    await callWebhook(oa.lineOaId, makeFollowBody());
    expect(welcomeReplyMessages()).toBeNull();
  });

  it("JSON text 1件 → text 1件", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "text", text: "JSON本文" }] });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(1);
    expect(msgs![0].text).toBe("JSON本文");
  });

  it("JSON text 複数件 → 順序維持で全件", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [
      { type: "text", text: "1通目" }, { type: "text", text: "2通目" }, { type: "text", text: "3通目" },
    ] });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs!.map((m) => m.text)).toEqual(["1通目", "2通目", "3通目"]);
  });

  it("JSON image 1件 → LINE image message（originalContentUrl / previewImageUrl）", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "image", imageUrl: "https://ex.com/a.png" }] });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(1);
    expect(msgs![0].type).toBe("image");
    expect(msgs![0].originalContentUrl).toBe("https://ex.com/a.png");
    expect(msgs![0].previewImageUrl).toBe("https://ex.com/a.png"); // 省略時は imageUrl 流用
  });

  it("text + image 混在 → 順序どおり変換", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [
      { type: "text", text: "やあ" }, { type: "image", imageUrl: "https://ex.com/a.png" },
    ] });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs![0].type).toBe("text");
    expect(msgs![0].text).toBe("やあ");
    expect(msgs![1].type).toBe("image");
    expect(msgs![1].originalContentUrl).toBe("https://ex.com/a.png");
  });

  it("最大5件（6件相当を与えても5件に収まる）", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "text" as const, text: `t${i + 1}` }));
    const oa = setupWelcomeWait({ welcomeMessagesJson: six });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(5);
  });

  it("startTrigger あり → 最後のメッセージに QR、なし → QR なし", async () => {
    // startTrigger あり
    let oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }, "ぼうけん");
    await callWebhook(oa.lineOaId, makeFollowBody());
    let msgs = welcomeReplyMessages();
    expect(msgs![0].quickReply).toBeUndefined();
    expect(msgs![1].quickReply.items[0].action).toEqual({ type: "message", label: "ぼうけん", text: "ぼうけん" });

    vi.clearAllMocks();
    // beforeEach 相当の最低限再設定
    mockPrisma.work.findMany.mockResolvedValue([]);
    mockPrisma.richMenu.findFirst.mockResolvedValue(null);
    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.globalCommand.findMany.mockResolvedValue([]);
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);
    // startTrigger なし
    oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "text", text: "A" }] }, null);
    await callWebhook(oa.lineOaId, makeFollowBody());
    msgs = welcomeReplyMessages();
    expect(msgs![0].quickReply).toBeUndefined();
  });

  it("最後が image でも QR は image メッセージに付与される", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [
      { type: "text", text: "やあ" }, { type: "image", imageUrl: "https://ex.com/a.png" },
    ] }, "ぼうけん");
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs![1].type).toBe("image");
    expect(msgs![1].quickReply.items[0].action).toEqual({ type: "message", label: "ぼうけん", text: "ぼうけん" });
  });

  it("不正 JSON（非配列）→ 既存 welcomeMessage に fallback", async () => {
    const oa = setupWelcomeWait({ welcomeMessage: "互換本文", welcomeMessagesJson: "{not json" });
    await callWebhook(oa.lineOaId, makeFollowBody());
    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(1);
    expect(msgs![0].text).toBe("互換本文");
  });

  // ── PR-B1: 送信前の入力中演出（welcomeLoadingSeconds）。reply 一括は維持。 ──
  it("welcomeLoadingSeconds=0 → loading なし・sleep なし・reply 一括", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "text", text: "A" }], welcomeLoadingSeconds: 0 });
    await callWebhook(oa.lineOaId, makeFollowBody());
    expect(mockShowLoadingAnimation).not.toHaveBeenCalled();
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockReplyToLine).toHaveBeenCalled();          // reply 一括で送信
    expect(welcomeReplyMessages()).toHaveLength(1);
  });

  it("welcomeLoadingSeconds=3 → showLoadingAnimation(uid,3,token) + sleep(3000) → reply 一括", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [
      { type: "text", text: "A" }, { type: "image", imageUrl: "https://ex.com/a.png" }, { type: "text", text: "B" },
    ], welcomeLoadingSeconds: 3 });
    await callWebhook(oa.lineOaId, makeFollowBody());
    expect(mockShowLoadingAnimation).toHaveBeenCalledTimes(1);
    expect(mockShowLoadingAnimation.mock.calls[0][0]).toBe(USER_ID);   // chatId=userId
    expect(mockShowLoadingAnimation.mock.calls[0][1]).toBe(3);          // loadingSeconds
    expect(mockSleep).toHaveBeenCalledWith(3000);
    // reply 一括（3件まとめて）・push / replyWithLagToLine は未使用
    expect(welcomeReplyMessages()).toHaveLength(3);
    expect(mockPushToLine).not.toHaveBeenCalled();
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });

  it("welcomeLoadingSeconds=8 でも reply 一括・push されない・最後に startTrigger QR", async () => {
    const oa = setupWelcomeWait({ welcomeMessagesJson: [
      { type: "text", text: "A" }, { type: "image", imageUrl: "https://ex.com/a.png" },
    ], welcomeLoadingSeconds: 8 }, "ぼうけん");
    await callWebhook(oa.lineOaId, makeFollowBody());
    expect(mockSleep).toHaveBeenCalledWith(8000);
    const msgs = welcomeReplyMessages();
    expect(msgs!).toHaveLength(2);
    expect(msgs![1].quickReply.items[0].action).toEqual({ type: "message", label: "ぼうけん", text: "ぼうけん" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("loading API が false を返しても reply は継続（sleep も実施）", async () => {
    mockShowLoadingAnimation.mockResolvedValueOnce(false);
    const oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "text", text: "A" }], welcomeLoadingSeconds: 2 });
    await callWebhook(oa.lineOaId, makeFollowBody());
    expect(mockSleep).toHaveBeenCalledWith(2000);
    expect(welcomeReplyMessages()).toHaveLength(1);       // reply 継続
  });

  it("loading API が例外でも reply は継続（catch・ログのみ）", async () => {
    mockShowLoadingAnimation.mockRejectedValueOnce(new Error("loading boom"));
    const oa = setupWelcomeWait({ welcomeMessagesJson: [{ type: "text", text: "A" }], welcomeLoadingSeconds: 2 });
    await callWebhook(oa.lineOaId, makeFollowBody());
    expect(mockSleep).toHaveBeenCalledWith(2000);          // 例外でも sleep は実施
    expect(welcomeReplyMessages()).toHaveLength(1);        // reply 継続
  });
});
