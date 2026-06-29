/**
 * src/__tests__/webhook-multi-work-start-keyword.test.ts
 *
 * 1 OA に複数作品を公開し、開始キーワードで別作品を開始する機能の webhook 検証。
 *
 * 検証する作品解決順（複数公開時）:
 *   1. 開始キーワード（Work.startKeyword ∨ 開始フェーズ Phase.startTrigger）一致 → その作品を開始
 *   2. 非一致 → 進行中作品（UserProgress）で通常処理
 *   3. 進行中なし → 勝手に開始しない（何もしない）
 * 単一公開時は既存パス（fetchActiveWork / handleStartTrigger 等）を維持。
 * postback は payload 由来（workId / messageId）で作品解決し、他 OA の id は拒否。
 * follow は複数公開時に auto_start しない。
 *
 * 判定: 開始 = userProgress.upsert 呼び出し（その workId）。何もしない = upsert/reply なし。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  oa:            { findFirst: vi.fn() },
  work:          { findFirst: vi.fn(), findMany: vi.fn() },
  richMenu:      { findFirst: vi.fn() },
  phase:         { findFirst: vi.fn(), findUnique: vi.fn() },
  userProgress:  { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
  message:       { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  globalCommand: { findMany: vi.fn() },
  tracking:      { findMany: vi.fn() },
  trackingEvent: { findFirst: vi.fn() },
  userTracking:  { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/cache", () => ({
  activeCache: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
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
vi.mock("@/lib/line", () => ({
  verifyLineSignature: vi.fn().mockReturnValue(true),
  isStartCommand:      vi.fn().mockReturnValue(false),
  isStartIntent:       vi.fn().mockReturnValue(false),
  isResetCommand:      vi.fn().mockReturnValue(false),
  isContinueCommand:   vi.fn().mockReturnValue(false),
  replyToLine:         mockReplyToLine,
  replyWithLagToLine:  mockReplyWithLagToLine,
  buildPhaseMessages:  vi.fn().mockReturnValue([{ type: "text", text: "phase-msg" }]),
  buildQuickReply:     vi.fn().mockReturnValue(undefined),
  buildQuickReplyFromItems: vi.fn().mockReturnValue(undefined),
  buildKeywordMessages: vi.fn().mockReturnValue([{ type: "text", text: "kw-msg" }]),
  pushToLine:          vi.fn().mockResolvedValue(undefined),
  sleep:               vi.fn().mockResolvedValue(undefined),
  resolveHeadSendDelayMs: vi.fn().mockReturnValue(0),
  RICHMENU_ACTIONS:    { START: "start", RESET: "reset", CONTINUE: "continue" },
}));

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
const OA_ID = "oa-uuid-mw", USER_ID = "U_mw_user";
const WORK_A = "work-A", WORK_B = "work-B", WORK_C = "work-C";
// 各作品の開始トリガー（開始フェーズ Phase.startTrigger）。C のみ startTrigger を持つ。
const TRIGGERS: Record<string, string | null> = { [WORK_A]: null, [WORK_B]: null, [WORK_C]: "はじめる物語" };

const mockOa = { id: OA_ID, title: "テストOA", lineOaId: "mwoa", channelId: "c", channelSecret: "s", channelAccessToken: "t", spreadsheetId: null, welcomeMessage: null, followAction: null };

function makeWork(id: string, startKeyword: string | null) {
  return { id, title: `作品${id}`, publishStatus: "active", sortOrder: 0, welcomeMessage: null, welcomeMessagesJson: [], welcomeLoadingSeconds: 0, followAction: "auto_start", resumeEnabled: true, startKeyword, systemCharacter: null };
}
function progressRow(workId: string, over: Record<string, unknown> = {}) {
  return { id: `prog-${workId}`, lineUserId: USER_ID, workId, currentPhaseId: `np-${workId}`, reachedEnding: false, flags: "{}", variables: "{}", waitingForInput: null, lastSentMessageIds: null, lastInteractedAt: new Date(), ...over };
}

function textBody(text: string) {
  return JSON.stringify({ destination: "U", events: [{ type: "message", replyToken: "rt", source: { userId: USER_ID, type: "user" }, message: { type: "text", text } }] });
}
function postbackBody(data: string) {
  return JSON.stringify({ destination: "U", events: [{ type: "postback", replyToken: "rt", source: { userId: USER_ID, type: "user" }, postback: { data } }] });
}
function followBody() {
  return JSON.stringify({ destination: "U", events: [{ type: "follow", replyToken: "rt", source: { userId: USER_ID, type: "user" } }] });
}
async function call(body: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-line-signature": "x" }, body,
  });
  return POST(req as never, { params: { oaId: mockOa.lineOaId } });
}
/** upsert された workId（開始された作品）。なければ null。 */
function upsertedWorkId(): string | null {
  const c = mockPrisma.userProgress.upsert.mock.calls[0];
  return c ? c[0].where.lineUserId_workId.workId : null;
}
/** resume 選択肢（action=resume_work）が reply に含まれたか。 */
function resumeOffered(): boolean {
  return mockReplyToLine.mock.calls.some((a) => JSON.stringify(a).includes("action=resume_work"));
}
/** workId 別に findUnique（getCachedProgress）の戻り値を設定する。 */
function setProgressByWork(map: Record<string, ReturnType<typeof progressRow> | null>) {
  mockPrisma.userProgress.findUnique.mockImplementation((args: { where: { lineUserId_workId: { workId: string } } }) =>
    Promise.resolve(map[args.where.lineUserId_workId.workId] ?? null));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  // 開始フェーズ（workId 別の startTrigger）。
  mockPrisma.phase.findFirst.mockImplementation((args: { where?: { workId?: string; phaseType?: string } }) => {
    const wid = args?.where?.workId;
    if (args?.where?.phaseType === "start" && wid) {
      return Promise.resolve({ id: `sp-${wid}`, phaseType: "start", startTrigger: TRIGGERS[wid] ?? null, resumeSummary: null });
    }
    return Promise.resolve(null);
  });
  mockPrisma.phase.findUnique.mockResolvedValue({ id: "np", phaseType: "normal", startTrigger: null, resumeSummary: null, transitionsFrom: [] });
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.message.findUnique.mockResolvedValue(null);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]);
  mockPrisma.userProgress.findUnique.mockResolvedValue(null);
  mockPrisma.userProgress.findFirst.mockResolvedValue(null);
  mockPrisma.userProgress.upsert.mockImplementation((args: { where: { lineUserId_workId: { workId: string } } }) =>
    Promise.resolve(progressRow(args.where.lineUserId_workId.workId, { currentPhaseId: `sp-${args.where.lineUserId_workId.workId}` })));
});

// ── 単一公開（後方互換）──
describe("単一公開Work: 既存挙動を維持", () => {
  it("startKeyword 未設定でも、開始フェーズ startTrigger で開始できる（既存パス）", async () => {
    const a = makeWork(WORK_A, null);
    mockPrisma.work.findMany.mockResolvedValue([a]);
    mockPrisma.work.findFirst.mockResolvedValue(a);
    TRIGGERS[WORK_A] = "はじめるA"; // 単一公開時は既存 handleStartTrigger が startTrigger で開始
    await call(textBody("はじめるA"));
    TRIGGERS[WORK_A] = null;
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledTimes(1);
    expect(upsertedWorkId()).toBe(WORK_A);
  });

  it("単一公開でも Work.startKeyword 一致で開始できる（新規ユーザーは開始）", async () => {
    const a = makeWork(WORK_A, "エリーゼ開始");
    mockPrisma.work.findMany.mockResolvedValue([a]);
    mockPrisma.work.findFirst.mockResolvedValue(a);
    await call(textBody("エリーゼ開始"));
    expect(upsertedWorkId()).toBe(WORK_A);
  });

  it("単一公開・startKeyword 非一致は従来の単一Work処理へ流す（開始しない）", async () => {
    const a = makeWork(WORK_A, "エリーゼ開始");
    mockPrisma.work.findMany.mockResolvedValue([a]);
    mockPrisma.work.findFirst.mockResolvedValue(a);
    mockPrisma.userProgress.findUnique.mockResolvedValue(progressRow(WORK_A)); // 進行中
    await call(textBody("こんにちは")); // startKeyword でも startTrigger でもない
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled(); // 開始扱いされない
  });

  it("単一公開・未完了progressありで startKeyword 再送 → resume選択肢（初期化しない）", async () => {
    const a = makeWork(WORK_A, "エリーゼ開始"); // resumeEnabled=true
    mockPrisma.work.findMany.mockResolvedValue([a]);
    mockPrisma.work.findFirst.mockResolvedValue(a);
    setProgressByWork({ [WORK_A]: progressRow(WORK_A) }); // 未完了 progress
    await call(textBody("エリーゼ開始"));
    expect(resumeOffered()).toBe(true);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled(); // 無条件初期化しない
  });
});

// ── 複数公開 ──
describe("複数公開Work: 開始キーワードで作品を解決", () => {
  beforeEach(() => {
    const works = [makeWork(WORK_A, "エリーゼ開始"), makeWork(WORK_B, "森の手紙"), makeWork(WORK_C, null)];
    mockPrisma.work.findMany.mockResolvedValue(works);
    mockPrisma.work.findFirst.mockResolvedValue(works[0]);
  });

  it("startKeyword 一致 → 正しい作品を開始（B）", async () => {
    await call(textBody("森の手紙"));
    expect(upsertedWorkId()).toBe(WORK_B);
  });

  it("前後スペース付きでも一致する", async () => {
    await call(textBody("  森の手紙 "));
    expect(upsertedWorkId()).toBe(WORK_B);
  });

  it("Phase.startTrigger 一致 → 正しい作品を開始（C）", async () => {
    await call(textBody("はじめる物語"));
    expect(upsertedWorkId()).toBe(WORK_C);
  });

  it("開始KW非一致 & 進行中なし → 何も開始しない", async () => {
    await call(textBody("こんにちは"));
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
    expect(mockReplyToLine).not.toHaveBeenCalled();
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });

  it("別作品(A)進行中でも、別作品(B)の開始KWで B を開始し、A の進行は消さない", async () => {
    mockPrisma.userProgress.findFirst.mockResolvedValue(progressRow(WORK_A)); // A 進行中
    await call(textBody("森の手紙"));
    expect(upsertedWorkId()).toBe(WORK_B);
    expect(mockPrisma.userProgress.delete).not.toHaveBeenCalled();
  });

  it("開始対象作品(B)に未完了progressがある状態で B の開始KW再送 → resume選択肢（初期化しない）", async () => {
    setProgressByWork({ [WORK_B]: progressRow(WORK_B) }); // B に未完了 progress
    await call(textBody("森の手紙"));
    expect(resumeOffered()).toBe(true);
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.userProgress.delete).not.toHaveBeenCalled();
  });

  it("非公開作品の開始KWには反応しない（findMany は active のみ返す）", async () => {
    // draft の作品 D（startKeyword="幽霊"）は active 一覧に含まれない → 一致しない → 何もしない。
    await call(textBody("幽霊"));
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });
});

// ── postback の作品解決 ──
describe("複数公開Work: postback は payload 由来で作品解決", () => {
  beforeEach(() => {
    const works = [makeWork(WORK_A, "エリーゼ開始"), makeWork(WORK_B, "森の手紙")];
    mockPrisma.work.findMany.mockResolvedValue(works);
    mockPrisma.work.findFirst.mockResolvedValue(works[0]);
  });

  it("quick_reply: sourceMessageId から作品を解決する（message.findFirst が呼ばれる）", async () => {
    mockPrisma.message.findFirst.mockResolvedValue({ workId: WORK_B });
    await call(postbackBody("action=quick_reply&sourceMessageId=msg-in-B&qrIndex=0"));
    const resolvedCall = mockPrisma.message.findFirst.mock.calls.find((c) => c[0]?.where?.id === "msg-in-B");
    expect(resolvedCall).toBeDefined();
  });

  it("他OAの workId を含む resume_work postback は処理されない（拒否）", async () => {
    await call(postbackBody("action=resume_work&workId=work-OTHER-OA&mode=resume"));
    expect(mockReplyToLine).not.toHaveBeenCalled();
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(mockPrisma.userProgress.update).not.toHaveBeenCalled();
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });
});

// ── follow ──
describe("follow（友だち追加）", () => {
  it("複数公開時は auto_start しない（OAあいさつのみ）", async () => {
    const works = [makeWork(WORK_A, "エリーゼ開始"), makeWork(WORK_B, "森の手紙")];
    mockPrisma.work.findMany.mockResolvedValue(works);
    mockPrisma.work.findFirst.mockResolvedValue(works[0]);
    mockPrisma.oa.findFirst.mockResolvedValue({ ...mockOa, welcomeMessage: "ようこそ！", followAction: "auto_start" });
    await call(followBody());
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled(); // 自動開始しない
    expect(mockReplyToLine).toHaveBeenCalled();                    // OAあいさつは送る
  });

  it("単一公開 + auto_start は従来どおり自動開始する", async () => {
    const a = makeWork(WORK_A, null);
    mockPrisma.work.findMany.mockResolvedValue([a]);
    mockPrisma.work.findFirst.mockResolvedValue(a);
    mockPrisma.oa.findFirst.mockResolvedValue({ ...mockOa, welcomeMessage: null, followAction: "auto_start" });
    await call(followBody());
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledTimes(1);
    expect(upsertedWorkId()).toBe(WORK_A);
  });
});
