/**
 * src/__tests__/webhook-ending-qr.test.ts
 *
 * NG2 案A の検証: reachedEnding=true でも frontier スコープの QR ナビ（E→D 等）だけは
 * 評価され、無関係テキストは従来どおり無視される（route.ts の reachedEnding 分岐移設 + deliverMatchedQr 共用）。
 *
 * シナリオ:
 *  1. reachedEnding=true + frontier=[E] + E の QR value 入力 → target_message(D) 送信・frontier が D に更新
 *  2. reachedEnding=true + 無関係テキスト → 無視（送信0・matchTransition 未呼び出し）
 *  3. reachedEnding=true + isStartIntent → handleStart（userProgress.upsert）
 *  4. reachedEnding=true + frontier=null → 無視（安全ゲート）
 *  5. reachedEnding=true + frontier=[E] + E の QR に一致しないテキスト → 無視
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

// activeCache は always-miss にして、毎テスト prisma モック（progress/phase）を使わせる
// （実 MemoryCache はテスト間で状態を持ち越し、per-test の findUnique モックを上書きするため）。
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

const mockReplyToLine        = vi.fn().mockResolvedValue(undefined);
const mockReplyWithLagToLine = vi.fn().mockResolvedValue(undefined);
const mockIsStartIntent      = vi.fn().mockReturnValue(false);
vi.mock("@/lib/line", () => ({
  verifyLineSignature:    vi.fn().mockReturnValue(true),
  isStartCommand:         vi.fn().mockReturnValue(false),
  isStartIntent:          mockIsStartIntent,
  isResetCommand:         vi.fn().mockReturnValue(false),
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

const ENDING_PHASE_ID = "aee0 end-phase".replace(/\s/g, "");
const E_ID = "5e768254-e1d1-4aaa-bbbb-000000000001";
const D_ID = "c28b6d12-d2d2-4bbb-cccc-000000000002";
// 案2 検証用: エンディング内の kind=response 応答キーワード（R）と、kind=normal 応答キーワード（N・対象外検証）。
const R_ID = "5e768254-e1d1-4aaa-bbbb-000000000003";
const N_ID = "5e768254-e1d1-4aaa-bbbb-000000000004";

const mockEndingPhase = {
  id: ENDING_PHASE_ID, phaseType: "ending", name: "エンディング",
  transitionsFrom: [],
  messages: [
    {
      id: E_ID, messageType: "text", kind: "normal", body: "E本文", assetUrl: null,
      altText: null, flexPayloadJson: null, triggerKeyword: null, sortOrder: 0,
      nextMessageId: null, freeInputEnabled: false, freeInputVariableKey: null, freeInputNextMessageId: null,
      lagMs: null, character: null,
      quickReplies: JSON.stringify([
        { label: "ありがとう",   action: "text", value: "ありがとう",   target_type: "message", target_message_id: D_ID },
        { label: "くじらさん…！", action: "text", value: "くじらさん…！", target_type: "message", target_message_id: D_ID },
      ]),
    },
    // 案2: エンディング内の応答キーワード（kind=response）。reachedEnding でも一致すれば応答される想定。
    {
      id: R_ID, messageType: "text", kind: "response", body: "真実の本文", assetUrl: null,
      altText: null, flexPayloadJson: null, triggerKeyword: "物語の真実を知る\nものがたりのしんじつをしる", sortOrder: 1,
      nextMessageId: null, freeInputEnabled: false, freeInputVariableKey: null, freeInputNextMessageId: null,
      lagMs: null, character: null, quickReplies: null,
    },
    // kind=normal の応答キーワード。reachedEnding 例外の対象外（response のみ許可）である検証用。
    {
      id: N_ID, messageType: "text", kind: "normal", body: "通常本文", assetUrl: null,
      altText: null, flexPayloadJson: null, triggerKeyword: "通常キーワード", sortOrder: 2,
      nextMessageId: null, freeInputEnabled: false, freeInputVariableKey: null, freeInputNextMessageId: null,
      lagMs: null, character: null, quickReplies: null,
    },
  ],
};

vi.mock("@/lib/runtime", () => ({
  buildRuntimeState: vi.fn().mockResolvedValue({ phase: { id: "p", messages: [], transitions: [] } }),
  matchTransition:   vi.fn().mockReturnValue(null),
  applySetFlags:     vi.fn().mockReturnValue({}),
  safeParseFlags:    vi.fn().mockReturnValue({}),
  safeParseVariables: vi.fn().mockReturnValue({}),
  safeParseWaitingForInput: vi.fn().mockReturnValue(null),
  fetchPhaseWithIncludes: vi.fn().mockResolvedValue(mockEndingPhase),
  drainAutoSendableItems: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/line-richmenu", () => ({ linkRichMenuToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/sheets-db", () => ({ loadSheetsData: vi.fn(), findActiveWork: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/sheets-scenario", () => ({ handleTextEventSheets: vi.fn(), handlePostbackEventSheets: vi.fn(), buildSystemSenderFromSheets: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ requireRole: vi.fn(), getOaIdFromWorkId: vi.fn() }));

// ── フィクスチャ ──
const OA_ID = "oa-uuid-end", WORK_ID = "work-uuid-end", USER_ID = "U_end_user", PROGRESS_ID = "prog-uuid-end";
const mockOa   = { id: OA_ID, title: "endOA", lineOaId: "endoa", channelId: "d", channelSecret: "s", channelAccessToken: "t", spreadsheetId: null };
const mockWork = { id: WORK_ID, title: "end作品", publishStatus: "active", sortOrder: 0, welcomeMessage: null, systemCharacter: null };

function endingProgress(over: Partial<{ lastSentMessageIds: string | null }>) {
  return {
    id: PROGRESS_ID, lineUserId: USER_ID, workId: WORK_ID,
    currentPhaseId: ENDING_PHASE_ID, reachedEnding: true,
    flags: "{}", variables: "{}", waitingForInput: null,
    lastSentMessageIds: JSON.stringify([E_ID]),
    lastInteractedAt: new Date(),
    ...over,
  };
}

const mockDMessage = {
  id: D_ID, messageType: "text", body: "D本文", assetUrl: null, altText: null,
  flexPayloadJson: null, quickReplies: null, nextMessageId: null, sortOrder: 0,
  imageActionType: null, imageActionText: null, imageActionUrl: null,
  imageActionLiffPageId: null, imageActionPostbackData: null, freeInputEnabled: false,
  lagMs: null, readReceiptMode: null, readDelayMs: null, typingEnabled: null,
  typingMinMs: null, typingMaxMs: null, loadingEnabled: null, loadingThresholdMs: null,
  loadingMinSeconds: null, loadingMaxSeconds: null, character: null,
};

const mockStartPhase = { id: "start-phase", phaseType: "start", startTrigger: "はじめる" };

function makeBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "message", replyToken: "rtoken", source: { userId: USER_ID, type: "user" }, message: { type: "text", text } }],
  });
}
async function callWebhook(text: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-line-signature": "dummy" }, body: makeBody(text),
  });
  return POST(req as unknown as import("next/server").NextRequest, { params: { oaId: mockOa.lineOaId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsStartIntent.mockReturnValue(false);
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.work.findMany.mockResolvedValue([mockWork]);
  mockPrisma.work.findFirst.mockResolvedValue(mockWork);
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(null);     // startTrigger なし（case 3 で上書き）
  mockPrisma.phase.findUnique.mockResolvedValue(mockEndingPhase);
  mockPrisma.message.findMany.mockResolvedValue([]);       // globalKw / start メッセージなど
  mockPrisma.globalCommand.findMany.mockResolvedValue([]); // グローバルコマンドなし
  mockPrisma.message.findFirst.mockResolvedValue(null);    // applyFreeInputPostEffect の freeInput 探索
  mockPrisma.message.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === D_ID ? mockDMessage : null));
  mockPrisma.userProgress.findUnique.mockResolvedValue(endingProgress({}));
  mockPrisma.userProgress.update.mockResolvedValue(endingProgress({}));
  mockPrisma.userProgress.upsert.mockResolvedValue(endingProgress({}));
});

describe("案A: reachedEnding でも frontier QR ナビは評価される", () => {
  it("1. frontier=[E] + E の QR value → target_message(D) 送信・frontier が D に更新", async () => {
    await callWebhook("くじらさん…！");

    // D が送られた（deliverMatchedQr の target_message 経路）
    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(mockPrisma.message.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: D_ID, isActive: true } }));
    // frontier が D に更新された（applyFreeInputPostEffect → userProgress.update）
    const updateCalls = mockPrisma.userProgress.update.mock.calls;
    const frontierUpdate = updateCalls.find((c) => typeof c[0]?.data?.lastSentMessageIds === "string");
    expect(frontierUpdate).toBeTruthy();
    expect(frontierUpdate![0].data.lastSentMessageIds).toContain(D_ID);
  });

  it("2. 無関係テキスト → 無視（送信0・matchTransition 未呼び出し）", async () => {
    const { matchTransition } = await import("@/lib/runtime");
    await callWebhook("全然関係ないテキスト");

    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(matchTransition).not.toHaveBeenCalled();
  });

  it("3. isStartIntent → handleStart（再スタート: userProgress.upsert）", async () => {
    mockIsStartIntent.mockReturnValue(true);
    mockPrisma.phase.findFirst.mockResolvedValue(mockStartPhase); // start phase あり
    await callWebhook("はじめる");

    expect(mockPrisma.userProgress.upsert).toHaveBeenCalled();
    // QR ナビ（D 送信）は走らない
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: D_ID, isActive: true } }));
  });

  it("4. frontier=null → 無視（安全ゲート: QR は評価しない）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(endingProgress({ lastSentMessageIds: null }));
    await callWebhook("くじらさん…！");

    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });

  it("5. frontier=[E] + E の QR に一致しないテキスト → 無視", async () => {
    await callWebhook("ありがと");  // value "ありがとう" と不一致

    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });
});

describe("案2: reachedEnding でも現在フェーズ内の response 応答キーワードは応答される（スコープ限定）", () => {
  it("1. 現在(ending)フェーズ内の response キーワード一致 → 応答送信・reachedEnding 維持", async () => {
    await callWebhook("物語の真実を知る");

    // 無視されず応答が送られる（deliverKeywordMatched → replyWithLagToLine）
    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    // reachedEnding=false へ変更する update は無い（進行状態は維持）。
    const setEndingFalse = mockPrisma.userProgress.update.mock.calls
      .some((c) => c[0]?.data?.reachedEnding === false);
    expect(setEndingFalse).toBe(false);
  });

  it("1b. 表記ゆれ（改行併記のもう一方）でも一致 → 応答送信", async () => {
    await callWebhook("ものがたりのしんじつをしる");
    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
  });

  it("2. 現在フェーズの応答キーワードに一致しないテキスト → 従来どおり無視", async () => {
    const { matchTransition } = await import("@/lib/runtime");
    await callWebhook("まったく無関係な文");

    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(matchTransition).not.toHaveBeenCalled();
  });

  it("3. 他フェーズにしかない response キーワード（現在フェーズに無い）→ 無視", async () => {
    // "なぞいち" は現在(ending)フェーズには存在しない → matchKeywordsInMemory 候補外
    await callWebhook("なぞいち");
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });

  it("4. 現在フェーズ内でも kind=normal の応答キーワードは対象外（response のみ許可）→ 無視", async () => {
    await callWebhook("通常キーワード");
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });
});
