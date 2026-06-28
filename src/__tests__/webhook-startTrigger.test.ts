/**
 * src/__tests__/webhook-startTrigger.test.ts
 *
 * startTrigger 仕様の検証テスト（resume 機能反映版）
 *
 * 現仕様:
 *  - startTrigger 一致時、途中離脱（resumeEnabled≠false・未エンディングで進行中）なら
 *    「途中から再開する / 最初からやり直す」の選択肢（postback action=resume_work）を提示する。
 *  - 新規 / 完了済み（reachedEnding）/ resumeEnabled=false は従来どおり handleStartTrigger で最初から開始。
 *  - startTrigger は triggerKeyword / transition より優先される。
 *
 * 判定: resume 提示 = userProgress.upsert が呼ばれず、reply に action=resume_work を含む。
 *       最初から開始 = userProgress.upsert が呼ばれる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Prisma ──
const mockPrisma = {
  oa:            { findFirst: vi.fn() },
  work:          { findFirst: vi.fn(), findMany: vi.fn() },
  richMenu:      { findFirst: vi.fn() },
  phase:         { findFirst: vi.fn(), findUnique: vi.fn() },
  userProgress:  { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
  message:       { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  globalCommand: { findMany: vi.fn() },
  tracking:      { findMany: vi.fn() },
  trackingEvent: { findFirst: vi.fn() },
  userTracking:  { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// activeCache は always-miss（per-test の prisma モックを使わせる）
vi.mock("@/lib/cache", () => ({
  activeCache: {
    get:    vi.fn().mockResolvedValue(null),
    set:    vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  TTL: { OA: 0, WORK: 0, PHASE: 0, PROGRESS: 0, GLOBAL_CMD: 0, GLOBAL_KW: 0, START_PHASE: 0, START_MSGS: 0 },
  CACHE_KEY: {
    oa:        (x: string) => `oa:${x}`,
    work:      (x: string) => `work:${x}`,
    phase:     (x: string) => `phase:${x}`,
    progress:  (u: string, w: string) => `progress:${u}:${w}`,
    globalCmd: (x: string) => `gc:${x}`,
    globalKw:  (x: string) => `gk:${x}`,
    startPhase:(x: string) => `sp:${x}`,
    startMsgs: (x: string) => `sm:${x}`,
  },
}));

vi.mock("@/lib/event-logger", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

const mockReplyToLine        = vi.fn().mockResolvedValue(undefined);
const mockReplyWithLagToLine = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/line", () => ({
  verifyLineSignature:      vi.fn().mockReturnValue(true),
  isStartCommand:           vi.fn().mockReturnValue(false),
  isStartIntent:            vi.fn().mockReturnValue(false),
  isResetCommand:           vi.fn().mockReturnValue(false),
  isContinueCommand:        vi.fn().mockReturnValue(false),
  replyToLine:              mockReplyToLine,
  replyWithLagToLine:       mockReplyWithLagToLine,
  buildPhaseMessages:       vi.fn().mockReturnValue([{ type: "text", text: "phase-msg" }]),
  buildQuickReply:          vi.fn().mockReturnValue(undefined),
  buildQuickReplyFromItems: vi.fn().mockReturnValue(undefined),
  buildKeywordMessages:     vi.fn().mockReturnValue([{ type: "text", text: "kw-msg" }]),
  pushToLine:               vi.fn().mockResolvedValue(undefined),
  sleep:                    vi.fn().mockResolvedValue(undefined),
  resolveHeadSendDelayMs:   vi.fn().mockReturnValue(0),
  RICHMENU_ACTIONS:         { START: "start", RESET: "reset", CONTINUE: "continue" },
}));

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
const OA_ID_DB = "oa-uuid-1", WORK_ID = "work-uuid-1", USER_ID = "U_test_user";
const PHASE_START_ID = "phase-start-id", PHASE_NORMAL_ID = "phase-normal-id", PROGRESS_ID = "progress-uuid-1";
const START_TRIGGER = "はじまり";   // 独自語（isStartCommand には当たらない → startTrigger ブロックで判定）

const mockOa = { id: OA_ID_DB, title: "テスト OA", lineOaId: "testoa", channelId: "dummy", channelSecret: "secret", channelAccessToken: "token", spreadsheetId: null };

/** resumeEnabled を切り替えられる work */
function makeWork(resumeEnabled: boolean | undefined = true) {
  return { id: WORK_ID, title: "テスト作品", publishStatus: "active", sortOrder: 0, welcomeMessage: null, systemCharacter: null, resumeEnabled };
}
const mockStartPhase = { id: PHASE_START_ID, phaseType: "start", startTrigger: START_TRIGGER, resumeSummary: null };

function midProgress(over: Record<string, unknown> = {}) {
  return {
    id: PROGRESS_ID, lineUserId: USER_ID, workId: WORK_ID,
    currentPhaseId: PHASE_NORMAL_ID, reachedEnding: false,
    flags: "{}", variables: "{}", waitingForInput: null,
    lastSentMessageIds: null, lastInteractedAt: new Date(), ...over,
  };
}

function makeWebhookBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "message", replyToken: "reply-token-xyz", source: { userId: USER_ID, type: "user" }, message: { type: "text", text } }],
  });
}
async function callWebhook(text: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-line-signature": "dummy" }, body: makeWebhookBody(text),
  });
  return POST(req as any, { params: { oaId: mockOa.lineOaId } });
}
function resumeChoiceOffered(): boolean {
  return mockReplyToLine.mock.calls.some((args) => JSON.stringify(args).includes("action=resume_work"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.work.findMany.mockResolvedValue([makeWork(true)]);
  mockPrisma.work.findFirst.mockResolvedValue(makeWork(true));
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(mockStartPhase);
  mockPrisma.phase.findUnique.mockResolvedValue({ id: PHASE_NORMAL_ID, phaseType: "normal", startTrigger: null, resumeSummary: null, transitionsFrom: [] });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.message.findFirst.mockResolvedValue(null);
  mockPrisma.message.findUnique.mockResolvedValue(null);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]);
  mockPrisma.userProgress.upsert.mockResolvedValue(midProgress({ currentPhaseId: PHASE_START_ID }));
  mockPrisma.userProgress.update.mockResolvedValue(midProgress());
});

// ── シナリオ 1: 進行中ユーザー → resume 選択肢 ──
describe("シナリオ 1: 進行中ユーザーには startTrigger で再開選択肢が出る", () => {
  it("resume 選択肢を提示し、progress はリセットしない（upsert なし）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(midProgress({ flags: JSON.stringify({ someFlag: true }) }));
    await callWebhook(START_TRIGGER);
    expect(resumeChoiceOffered()).toBe(true);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("resumeEnabled=false の作品は従来どおり最初から開始（upsert・resume なし）", async () => {
    mockPrisma.work.findFirst.mockResolvedValue(makeWork(false));
    mockPrisma.work.findMany.mockResolvedValue([makeWork(false)]);
    mockPrisma.userProgress.findUnique.mockResolvedValue(midProgress());
    await callWebhook(START_TRIGGER);
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();
  });
});

// ── シナリオ 2: エンディング到達済み → 最初から開始 ──
describe("シナリオ 2: エンディング到達済みユーザーは startTrigger で最初から開始", () => {
  it("reachedEnding=true は resume を出さず upsert でリセットされる", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(midProgress({ currentPhaseId: "phase-ending-id", reachedEnding: true }));
    await callWebhook(START_TRIGGER);
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();
    const upsertCall = mockPrisma.userProgress.upsert.mock.calls[0][0];
    expect(upsertCall.update.reachedEnding).toBe(false);
    expect(upsertCall.update.currentPhaseId).toBe(PHASE_START_ID);
  });
});

// ── シナリオ 3: 新規ユーザー → upsert データ詳細 ──
describe("シナリオ 3: 新規ユーザーは flags / reachedEnding / currentPhaseId が初期化される", () => {
  it("create / update 両方のデータを検証する", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);
    await callWebhook(START_TRIGGER);

    expect(resumeChoiceOffered()).toBe(false);
    const upsertCall = mockPrisma.userProgress.upsert.mock.calls[0][0];
    expect(upsertCall.where.lineUserId_workId).toEqual({ lineUserId: USER_ID, workId: WORK_ID });
    expect(upsertCall.create.lineUserId).toBe(USER_ID);
    expect(upsertCall.create.workId).toBe(WORK_ID);
    expect(upsertCall.create.currentPhaseId).toBe(PHASE_START_ID);
    expect(upsertCall.create.reachedEnding).toBe(false);
    expect(upsertCall.create.flags).toBe("{}");
    expect(upsertCall.update.currentPhaseId).toBe(PHASE_START_ID);
    expect(upsertCall.update.reachedEnding).toBe(false);
    expect(upsertCall.update.flags).toBe("{}");
  });
});

// ── シナリオ 4: 優先順位 ──
describe("シナリオ 4: startTrigger は triggerKeyword / transition より優先される", () => {
  it("新規ユーザー + startTrigger 一致 → upsert（triggerKeyword 照合 message.findMany は呼ばれない）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);
    await callWebhook(START_TRIGGER);

    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();
    const triggerKeywordCall = mockPrisma.message.findMany.mock.calls.find(
      (args) => args[0]?.where?.triggerKeyword !== undefined,
    );
    expect(triggerKeywordCall).toBeUndefined();
  });

  it("startTrigger 不一致のテキストは開始扱いされない（resume も reset もしない）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(midProgress());
    await callWebhook("全然違うテキスト");

    // startTrigger 不一致 = 開始処理に入らない（resume 選択肢を出さず、progress リセットもしない）。
    // 以降の通常フロー（QR/キーワード/遷移等）の挙動は各専用テストで担保。
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("NFKC 正規化マッチ: 全角テキストでも startTrigger と一致する（新規ユーザーは upsert）", async () => {
    mockPrisma.phase.findFirst.mockResolvedValue({ ...mockStartPhase, startTrigger: "start" });
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);
    await callWebhook("ｓｔａｒｔ"); // 全角
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();
  });
});
