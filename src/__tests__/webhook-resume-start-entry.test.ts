/**
 * src/__tests__/webhook-resume-start-entry.test.ts
 *
 * P0-A「途中からはじめる」修正の検証。
 *
 * 開始意図の各入口（A: text の開始コマンド / D: startTrigger 一致 / G: postback START）で、
 * 途中離脱ユーザー（resumeEnabled≠false・未エンディングで進行中）には
 * 「途中から再開する / 最初からやり直す」の選択肢（postback action=resume_work）を提示し、
 * それ以外（新規 / 完了済み / resumeEnabled=false / 明示リセット）は従来どおり最初から開始することを検証する。
 *
 * 判定: resume 提示 = userProgress.upsert が呼ばれず、reply に action=resume_work を含む。
 *       最初から開始 = userProgress.upsert が呼ばれる（resume_work を含まない）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 外部依存モック（import より先） ──
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

// event-logger（resume_choice_shown / selected の計測。no-op）
vi.mock("@/lib/event-logger", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

const mockReplyToLine        = vi.fn().mockResolvedValue(undefined);
const mockReplyWithLagToLine = vi.fn().mockResolvedValue(undefined);
const mockIsStartCommand     = vi.fn().mockReturnValue(false);
const mockIsStartIntent      = vi.fn().mockReturnValue(false);
const mockIsResetCommand     = vi.fn().mockReturnValue(false);
vi.mock("@/lib/line", () => ({
  verifyLineSignature:    vi.fn().mockReturnValue(true),
  isStartCommand:         mockIsStartCommand,
  isStartIntent:          mockIsStartIntent,
  isResetCommand:         mockIsResetCommand,
  isContinueCommand:      vi.fn().mockReturnValue(false),
  replyToLine:            mockReplyToLine,
  replyWithLagToLine:     mockReplyWithLagToLine,
  buildPhaseMessages:     vi.fn().mockReturnValue([{ type: "text", text: "phase-msg" }]),
  buildQuickReply:        vi.fn().mockReturnValue(undefined),
  buildQuickReplyFromItems: vi.fn().mockReturnValue(undefined),
  buildKeywordMessages:   vi.fn().mockReturnValue([{ type: "text", text: "sent-msg" }]),
  pushToLine:             vi.fn().mockResolvedValue(undefined),
  sleep:                  vi.fn().mockResolvedValue(undefined),
  resolveHeadSendDelayMs: vi.fn().mockReturnValue(0),
  RICHMENU_ACTIONS:       { START: "start", RESET: "reset", CONTINUE: "continue" },
}));

vi.mock("@/lib/runtime", () => ({
  buildRuntimeState: vi.fn().mockResolvedValue({ phase: { id: "p", messages: [], transitions: [] } }),
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
const OA_ID = "oa-uuid-r", WORK_ID = "work-uuid-r", USER_ID = "U_resume_user", PROGRESS_ID = "prog-uuid-r";
const START_PHASE_ID = "phase-start-r", MID_PHASE_ID = "phase-mid-r", END_PHASE_ID = "phase-end-r";
const CUSTOM_TRIGGER = "はじまり";        // 独自語（isStartCommand には当たらない）
const GENERIC_START  = "はじめる";        // 汎用開始語（isStartCommand に当たる）

const mockOa   = { id: OA_ID, title: "rOA", lineOaId: "roa", channelId: "d", channelSecret: "s", channelAccessToken: "t", spreadsheetId: null };

/** resumeEnabled を切り替えられる work フィクスチャ */
function makeWork(resumeEnabled: boolean | undefined) {
  return { id: WORK_ID, title: "r作品", publishStatus: "active", sortOrder: 0, welcomeMessage: null, systemCharacter: null, resumeEnabled };
}

const mockStartPhase = { id: START_PHASE_ID, phaseType: "start", startTrigger: CUSTOM_TRIGGER, resumeSummary: null };

/** 進行中（途中離脱）progress */
function midProgress() {
  return {
    id: PROGRESS_ID, lineUserId: USER_ID, workId: WORK_ID,
    currentPhaseId: MID_PHASE_ID, reachedEnding: false,
    flags: "{}", variables: "{}", waitingForInput: null,
    lastSentMessageIds: null, lastInteractedAt: new Date(),
  };
}
/** 完了済み progress */
function endedProgress() {
  return { ...midProgress(), currentPhaseId: END_PHASE_ID, reachedEnding: true };
}

function makeTextBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "message", replyToken: "rtoken", source: { userId: USER_ID, type: "user" }, message: { type: "text", text } }],
  });
}
function makePostbackBody(data: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "postback", replyToken: "rtoken", source: { userId: USER_ID, type: "user" }, postback: { data } }],
  });
}
async function callWebhook(rawBody: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-line-signature": "dummy" }, body: rawBody,
  });
  return POST(req as unknown as import("next/server").NextRequest, { params: { oaId: mockOa.lineOaId } });
}

/** reply に resume 選択肢（postback action=resume_work）が含まれたか */
function resumeChoiceOffered(): boolean {
  return mockReplyToLine.mock.calls.some((args) => JSON.stringify(args).includes("action=resume_work"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsStartCommand.mockReturnValue(false);
  mockIsStartIntent.mockReturnValue(false);
  mockIsResetCommand.mockReturnValue(false);
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.work.findMany.mockResolvedValue([makeWork(true)]);
  mockPrisma.work.findFirst.mockResolvedValue(makeWork(true));
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(mockStartPhase);   // startTrigger 取得
  mockPrisma.phase.findUnique.mockResolvedValue({ id: MID_PHASE_ID, phaseType: "normal", startTrigger: null, resumeSummary: null });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.message.findFirst.mockResolvedValue(null);
  mockPrisma.message.findUnique.mockResolvedValue(null);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]);
  mockPrisma.userProgress.findUnique.mockResolvedValue(midProgress());
  mockPrisma.userProgress.upsert.mockResolvedValue(midProgress());
  mockPrisma.userProgress.update.mockResolvedValue(midProgress());
});

// ─────────────────────────────────────────────
//  入口 A: text の開始コマンド（はじめる / スタート 等）
// ─────────────────────────────────────────────
describe("入口A: text 開始コマンド", () => {
  it("はじめる + 進行中 + resumeEnabled=true → resume 選択肢（upsert なし）", async () => {
    mockIsStartCommand.mockReturnValue(true);
    await callWebhook(makeTextBody(GENERIC_START));
    expect(resumeChoiceOffered()).toBe(true);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("はじめる + resumeEnabled=false → 従来どおり handleStart（upsert・resume なし）", async () => {
    mockIsStartCommand.mockReturnValue(true);
    mockPrisma.work.findFirst.mockResolvedValue(makeWork(false));
    mockPrisma.work.findMany.mockResolvedValue([makeWork(false)]);
    await callWebhook(makeTextBody(GENERIC_START));
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });

  it("はじめる + 完了済み（reachedEnding）→ resume を出さず handleStart（upsert）", async () => {
    mockIsStartCommand.mockReturnValue(true);
    mockPrisma.userProgress.findUnique.mockResolvedValue(endedProgress());
    await callWebhook(makeTextBody(GENERIC_START));
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });

  it("はじめる + 新規ユーザー（progress なし）→ 新規開始（upsert・resume なし）", async () => {
    mockIsStartCommand.mockReturnValue(true);
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);
    await callWebhook(makeTextBody(GENERIC_START));
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });

  it("リセット（isResetCommand）+ 進行中 → 即リセット維持（upsert・resume なし）", async () => {
    mockIsResetCommand.mockReturnValue(true);
    await callWebhook(makeTextBody("リセット"));
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  入口 D: startTrigger（独自語）一致
// ─────────────────────────────────────────────
describe("入口D: startTrigger 一致", () => {
  it("独自語 startTrigger + 進行中 + resumeEnabled=true → resume 選択肢（upsert なし）", async () => {
    // isStartCommand/Intent には当たらない独自語。startTrigger ブロックで判定される。
    await callWebhook(makeTextBody(CUSTOM_TRIGGER));
    expect(resumeChoiceOffered()).toBe(true);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("独自語 startTrigger + 新規ユーザー → 最初から開始（upsert・resume なし）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);
    await callWebhook(makeTextBody(CUSTOM_TRIGGER));
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  入口 G/H: postback（リッチメニュー START / RESET, resume_work）
// ─────────────────────────────────────────────
describe("入口G/H: postback", () => {
  it("postback START + 進行中 + resumeEnabled=true → resume 選択肢（upsert なし）", async () => {
    await callWebhook(makePostbackBody("start"));
    expect(resumeChoiceOffered()).toBe(true);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });

  it("postback RESET + 進行中 → 即リセット維持（upsert・resume なし）", async () => {
    await callWebhook(makePostbackBody("reset"));
    expect(resumeChoiceOffered()).toBe(false);
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });

  it("postback resume_work mode=restart → 最初からやり直す（upsert）", async () => {
    await callWebhook(makePostbackBody(`action=resume_work&workId=${WORK_ID}&mode=restart`));
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
  });

  it("postback resume_work mode=resume → 途中から再開（upsert なし・reply あり）", async () => {
    await callWebhook(makePostbackBody(`action=resume_work&workId=${WORK_ID}&mode=resume`));
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
    // 現在フェーズの再送（replyWithLagToLine もしくは replyToLine のいずれか）が起きる
    expect(mockReplyWithLagToLine.mock.calls.length + mockReplyToLine.mock.calls.length).toBeGreaterThan(0);
  });
});
