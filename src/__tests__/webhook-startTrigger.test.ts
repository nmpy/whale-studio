/**
 * src/__tests__/webhook-startTrigger.test.ts
 *
 * startTrigger 仕様の検証テスト
 *
 * 検証シナリオ:
 *  1. 進行中ユーザーでも startTrigger 一致で最初からやり直せる
 *  2. エンディング到達済みでも startTrigger 一致で再開できる
 *  3. upsert で flags / reachedEnding / currentPhaseId が初期化される
 *  4. startTrigger は triggerKeyword / puzzle / transition より優先される
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";

// ─────────────────────────────────────────────
//  外部依存モック（importより先に宣言）
// ─────────────────────────────────────────────

// Prisma
const mockPrisma = {
  oa:            { findFirst: vi.fn() },
  work:          { findFirst: vi.fn(), findMany: vi.fn() },
  richMenu:      { findFirst: vi.fn() },
  phase:         { findFirst: vi.fn(), findUnique: vi.fn() },
  userProgress:  { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
  message:       { findMany: vi.fn() },
  tracking:      { findMany: vi.fn() },
  trackingEvent: { findFirst: vi.fn() },
  userTracking:  { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// LINE ユーティリティ
const mockReplyToLine = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/line", () => ({
  verifyLineSignature:  vi.fn().mockReturnValue(true),
  isStartCommand:       vi.fn().mockReturnValue(false),
  isResetCommand:       vi.fn().mockReturnValue(false),
  isContinueCommand:    vi.fn().mockReturnValue(false),
  replyToLine:          mockReplyToLine,
  buildPhaseMessages:   vi.fn().mockReturnValue([{ type: "text", text: "phase-msg" }]),
  buildQuickReply:      vi.fn().mockReturnValue(undefined),
  buildKeywordMessages: vi.fn().mockReturnValue([{ type: "text", text: "kw-msg" }]),
  RICHMENU_ACTIONS:     { START: "start", RESET: "reset", CONTINUE: "continue" },
}));

// runtime
vi.mock("@/lib/runtime", () => ({
  buildRuntimeState: vi.fn().mockResolvedValue({ phase: { id: "p1", messages: [], transitions: [] } }),
  matchTransition:   vi.fn().mockReturnValue(null),
  applySetFlags:     vi.fn().mockReturnValue({}),
  safeParseFlags:    vi.fn().mockReturnValue({}),
}));

// richmenu
vi.mock("@/lib/line-richmenu", () => ({
  linkRichMenuToUser: vi.fn().mockResolvedValue(undefined),
}));

// sheets-db / sheets-scenario（Sheetsモードは今回非対象）
vi.mock("@/lib/sheets-db", () => ({
  loadSheetsData: vi.fn(),
  findActiveWork:  vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/sheets-scenario", () => ({
  handleTextEventSheets:    vi.fn(),
  handlePostbackEventSheets: vi.fn(),
  buildSystemSenderFromSheets: vi.fn(),
}));

// rbac
vi.mock("@/lib/rbac", () => ({
  requireRole:         vi.fn(),
  getOaIdFromWorkId:   vi.fn(),
}));

// ─────────────────────────────────────────────
//  テスト用フィクスチャ
// ─────────────────────────────────────────────

const OA_ID_DB   = "oa-uuid-1";
const WORK_ID    = "work-uuid-1";
const USER_ID    = "U_test_user";
const PHASE_START_ID   = "phase-start-id";
const PHASE_NORMAL_ID  = "phase-normal-id";
const PROGRESS_ID      = "progress-uuid-1";
const START_TRIGGER    = "はじまり";

const mockOa = {
  id:                 OA_ID_DB,
  title:              "テスト OA",
  lineOaId:           "testoa",
  channelId:          "dummy",
  channelSecret:      "secret",
  channelAccessToken: "token",
  spreadsheetId:      null,
};

const mockWork = {
  id:             WORK_ID,
  title:          "テスト作品",
  publishStatus:  "active",
  sortOrder:      0,
  welcomeMessage: null,
  systemCharacter: null,
};

const mockStartPhase = {
  id:           PHASE_START_ID,
  phaseType:    "start",
  startTrigger: START_TRIGGER,
  // transitionsFrom は handleStartTrigger では使用しない（startPhase.id に留まる仕様）
};

/**
 * テキストメッセージの Webhook ペイロードを生成する
 */
function makeWebhookBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [
      {
        type:       "message",
        replyToken: "reply-token-xyz",
        source:     { userId: USER_ID, type: "user" },
        message:    { type: "text", text },
      },
    ],
  });
}

/**
 * POST /api/line/[oaId]/webhook を呼び出す
 */
async function callWebhook(text: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const body = makeWebhookBody(text);
  const req  = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method:  "POST",
    headers: { "content-type": "application/json", "x-line-signature": "dummy" },
    body,
  });
  return POST(req as any, { params: { oaId: mockOa.lineOaId } });
}

// ─────────────────────────────────────────────
//  共通セットアップ
// ─────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // OA 取得
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  // Work 取得
  mockPrisma.work.findMany.mockResolvedValue([mockWork]);
  mockPrisma.work.findFirst.mockResolvedValue(mockWork);
  // リッチメニュー（なし）
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  // startPhase（startTrigger あり）
  mockPrisma.phase.findFirst.mockResolvedValue(mockStartPhase);
  // kind="start" メッセージなし（フォールバックへ）
  mockPrisma.message.findMany.mockResolvedValue([]);
  // upsert は成功を返す
  mockPrisma.userProgress.upsert.mockResolvedValue({
    id:             PROGRESS_ID,
    lineUserId:     USER_ID,
    workId:         WORK_ID,
    currentPhaseId: PHASE_NORMAL_ID,
    reachedEnding:  false,
    flags:          "{}",
    lastInteractedAt: new Date(),
  });
});

// ─────────────────────────────────────────────
//  シナリオ 1: 進行中ユーザーが startTrigger を送信
// ─────────────────────────────────────────────

describe("シナリオ 1: 進行中ユーザーでも startTrigger で最初からやり直せる", () => {
  it("upsert が呼ばれ progress がリセットされる", async () => {
    // 既存 progress あり（進行中）
    mockPrisma.userProgress.findUnique.mockResolvedValue({
      id:             PROGRESS_ID,
      lineUserId:     USER_ID,
      workId:         WORK_ID,
      currentPhaseId: PHASE_NORMAL_ID,
      reachedEnding:  false,
      flags:          JSON.stringify({ someFlag: true }),
      lastInteractedAt: new Date(),
    });

    await callWebhook(START_TRIGGER);

    // upsert が呼ばれたことを確認
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();

    const upsertCall = mockPrisma.userProgress.upsert.mock.calls[0][0];

    // update データが初期化されているか
    expect(upsertCall.update.currentPhaseId).toBe(PHASE_START_ID); // startPhase.id に留まる
    expect(upsertCall.update.reachedEnding).toBe(false);
    expect(upsertCall.update.flags).toBe("{}");
  });

  it("progress.findUnique より先に startTrigger 照合が走り、findUnique は呼ばれない", async () => {
    // findUnique が呼ばれても問題ないが、startTrigger 一致後は呼ばれないはず
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);

    await callWebhook(START_TRIGGER);

    // startTrigger 一致 → handleStartTrigger へ → upsert 呼ばれる
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();
    // findUnique は startTrigger 一致後は呼ばれない（早期 return）
    expect(mockPrisma.userProgress.findUnique).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 2: エンディング到達済みユーザーが startTrigger を送信
// ─────────────────────────────────────────────

describe("シナリオ 2: エンディング到達済みユーザーでも startTrigger で再開できる", () => {
  it("reachedEnding=true の progress でも upsert でリセットされる", async () => {
    // エンディング到達済み progress
    mockPrisma.userProgress.findUnique.mockResolvedValue({
      id:             PROGRESS_ID,
      lineUserId:     USER_ID,
      workId:         WORK_ID,
      currentPhaseId: "phase-ending-id",
      reachedEnding:  true,
      flags:          "{}",
      lastInteractedAt: new Date(),
    });

    await callWebhook(START_TRIGGER);

    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();

    const upsertCall = mockPrisma.userProgress.upsert.mock.calls[0][0];
    // reachedEnding が false にリセット
    expect(upsertCall.update.reachedEnding).toBe(false);
    // currentPhaseId が startPhase.id にリセットされる
    expect(upsertCall.update.currentPhaseId).toBe(PHASE_START_ID);
  });
});

// ─────────────────────────────────────────────
//  シナリオ 3: upsert データ詳細検証
// ─────────────────────────────────────────────

describe("シナリオ 3: flags / reachedEnding / currentPhaseId が正しく初期化される", () => {
  it("create / update 両方のデータを検証する", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);

    await callWebhook(START_TRIGGER);

    const upsertCall = mockPrisma.userProgress.upsert.mock.calls[0][0];

    // where 句
    expect(upsertCall.where.lineUserId_workId).toEqual({
      lineUserId: USER_ID,
      workId:     WORK_ID,
    });

    // create データ
    expect(upsertCall.create.lineUserId).toBe(USER_ID);
    expect(upsertCall.create.workId).toBe(WORK_ID);
    expect(upsertCall.create.currentPhaseId).toBe(PHASE_START_ID); // startPhase.id に留まる
    expect(upsertCall.create.reachedEnding).toBe(false);
    expect(upsertCall.create.flags).toBe("{}");

    // update データ（create と同等）
    expect(upsertCall.update.currentPhaseId).toBe(PHASE_START_ID); // startPhase.id に留まる
    expect(upsertCall.update.reachedEnding).toBe(false);
    expect(upsertCall.update.flags).toBe("{}");
  });

  it("遷移の有無に関わらず常に startPhase.id が初期フェーズになる", async () => {
    // 遷移なし startPhase（仕様上どちらも startPhase.id に留まる）
    mockPrisma.phase.findFirst.mockResolvedValue({
      id:           PHASE_START_ID,
      phaseType:    "start",
      startTrigger: START_TRIGGER,
    });
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);

    await callWebhook(START_TRIGGER);

    const upsertCall = mockPrisma.userProgress.upsert.mock.calls[0][0];
    expect(upsertCall.create.currentPhaseId).toBe(PHASE_START_ID);
    expect(upsertCall.update.currentPhaseId).toBe(PHASE_START_ID);
  });
});

// ─────────────────────────────────────────────
//  シナリオ 4: 優先順位 — startTrigger > triggerKeyword > transition
// ─────────────────────────────────────────────

describe("シナリオ 4: startTrigger は triggerKeyword / puzzle / transition より優先される", () => {
  it("同一テキストに triggerKeyword も設定されていても startTrigger が勝つ", async () => {
    // triggerKeyword でも反応するメッセージが存在すると仮定
    // ただし startTrigger が先に評価され早期 return するので
    // message.findMany（triggerKeyword 照合用）は呼ばれないはず
    mockPrisma.userProgress.findUnique.mockResolvedValue({
      id:             PROGRESS_ID,
      lineUserId:     USER_ID,
      workId:         WORK_ID,
      currentPhaseId: PHASE_NORMAL_ID,
      reachedEnding:  false,
      flags:          "{}",
      lastInteractedAt: new Date(),
    });

    await callWebhook(START_TRIGGER);

    // startTrigger で upsert が呼ばれた
    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();

    // triggerKeyword 照合用 message.findMany は呼ばれていない
    // （startTrigger 一致後に早期 return するため）
    const msgFindCalls = mockPrisma.message.findMany.mock.calls;
    const triggerKeywordCall = msgFindCalls.find(
      (args) => args[0]?.where?.triggerKeyword !== undefined
    );
    expect(triggerKeywordCall).toBeUndefined();
  });

  it("startTrigger 不一致のテキストは通常フローに流れる（matchTransition が呼ばれる）", async () => {
    const { matchTransition } = await import("@/lib/runtime");

    // 進行中ユーザー
    mockPrisma.userProgress.findUnique.mockResolvedValue({
      id:             PROGRESS_ID,
      lineUserId:     USER_ID,
      workId:         WORK_ID,
      currentPhaseId: PHASE_NORMAL_ID,
      reachedEnding:  false,
      flags:          "{}",
      lastInteractedAt: new Date(),
    });

    // currentPhase を返す
    mockPrisma.phase.findUnique.mockResolvedValue({
      id:              PHASE_NORMAL_ID,
      phaseType:       "normal",
      transitionsFrom: [],
    });

    // startTrigger とは異なるテキストを送信
    await callWebhook("全然違うテキスト");

    // upsert は呼ばれない（startTrigger 不一致）
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();

    // matchTransition が呼ばれる（通常の遷移フロー）
    expect(matchTransition).toHaveBeenCalled();
  });

  it("NFKC 正規化マッチ: 全角テキストでも startTrigger と一致する", async () => {
    // startTrigger: "はじまり"、入力: 全角スペース付きなど
    mockPrisma.phase.findFirst.mockResolvedValue({
      ...mockStartPhase,
      startTrigger: "start",
    });
    mockPrisma.userProgress.findUnique.mockResolvedValue(null);

    // 半角 → 正規化後一致
    await callWebhook("ｓｔａｒｔ"); // 全角

    expect(mockPrisma.userProgress.upsert).toHaveBeenCalledOnce();
  });
});
