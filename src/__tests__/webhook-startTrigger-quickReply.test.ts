/**
 * src/__tests__/webhook-startTrigger-quickReply.test.ts
 *
 * startTrigger 再開時に quickReply が LINE reply payload に含まれることを検証するテスト
 *
 * 検証シナリオ:
 *  1. kind="start" メッセージに quickReplies が設定されていると LINE payload に含まれる
 *  2. kind="start" メッセージが 0 件 → フォールバック（buildPhaseMessages 経由）でも quickReply が含まれる
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

// LINE ユーティリティ — 実際の buildQuickReplyFromItems / buildKeywordMessages を使う
const mockReplyToLine = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/line", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line")>();
  return {
    ...actual,
    verifyLineSignature: vi.fn().mockReturnValue(true),
    isStartCommand:      vi.fn().mockReturnValue(false),
    isResetCommand:      vi.fn().mockReturnValue(false),
    isContinueCommand:   vi.fn().mockReturnValue(false),
    replyToLine:         mockReplyToLine,
    buildPhaseMessages:  actual.buildPhaseMessages,
    buildKeywordMessages: actual.buildKeywordMessages,
    buildQuickReply:     actual.buildQuickReply,
    RICHMENU_ACTIONS:    { START: "start", RESET: "reset", CONTINUE: "continue" },
  };
});

// runtime — 実際の buildRuntimeState / matchTransition を使う
vi.mock("@/lib/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime")>();
  return { ...actual };
});

// richmenu
vi.mock("@/lib/line-richmenu", () => ({
  linkRichMenuToUser: vi.fn().mockResolvedValue(undefined),
}));

// sheets（今回非対象）
vi.mock("@/lib/sheets-db", () => ({
  loadSheetsData:  vi.fn(),
  findActiveWork:  vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/sheets-scenario", () => ({
  handleTextEventSheets:       vi.fn(),
  handlePostbackEventSheets:   vi.fn(),
  buildSystemSenderFromSheets: vi.fn(),
}));

// rbac
vi.mock("@/lib/rbac", () => ({
  requireRole:       vi.fn(),
  getOaIdFromWorkId: vi.fn(),
}));

// ─────────────────────────────────────────────
//  テスト用フィクスチャ
// ─────────────────────────────────────────────

const OA_ID_DB        = "oa-uuid-1";
const WORK_ID         = "work-uuid-1";
const USER_ID         = "U_test_qr";
const PHASE_START_ID  = "phase-start-id";
const PHASE_NORMAL_ID = "phase-normal-id";
const PROGRESS_ID     = "progress-uuid-qr";
const START_TRIGGER   = "はじまり";

const QUICK_REPLIES_JSON = JSON.stringify([
  { label: "次へ", action: "message", value: "次へ" },
  { label: "詳細", action: "url",     value: "https://example.com" },
]);

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
  id:              WORK_ID,
  title:           "テスト作品",
  publishStatus:   "active",
  sortOrder:       0,
  welcomeMessage:  null,
  systemCharacter: null,
};

const mockStartPhase = {
  id:           PHASE_START_ID,
  phaseType:    "start",
  startTrigger: START_TRIGGER,
  transitionsFrom: [
    { toPhaseId: PHASE_NORMAL_ID, sortOrder: 0, isActive: true },
  ],
};

const mockUpsertResult = {
  id:               PROGRESS_ID,
  lineUserId:       USER_ID,
  workId:           WORK_ID,
  currentPhaseId:   PHASE_NORMAL_ID,
  reachedEnding:    false,
  flags:            "{}",
  lastInteractedAt: new Date(),
  createdAt:        new Date(),
  updatedAt:        new Date(),
};

function makeWebhookBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [
      {
        type:       "message",
        replyToken: "reply-token-qr",
        source:     { userId: USER_ID, type: "user" },
        message:    { type: "text", text },
      },
    ],
  });
}

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

  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.work.findMany.mockResolvedValue([mockWork]);
  mockPrisma.work.findFirst.mockResolvedValue(mockWork);
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(mockStartPhase);
  mockPrisma.phase.findUnique.mockResolvedValue({ phaseType: "normal" });
  mockPrisma.userProgress.findUnique.mockResolvedValue(null);
  mockPrisma.userProgress.upsert.mockResolvedValue(mockUpsertResult);
});

// ─────────────────────────────────────────────
//  シナリオ 1: kind="start" メッセージの quickReplies が LINE payload に含まれる
// ─────────────────────────────────────────────

describe("シナリオ 1: kind=start メッセージの quickReplies が LINE reply に含まれる", () => {
  it("quickReplies を持つ kind=start メッセージが replyToLine に渡る", async () => {
    // kind="start" メッセージに quickReplies を設定
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id:              "msg-start-1",
        triggerKeyword:  null,
        messageType:     "text",
        body:            "はじまりのメッセージ",
        assetUrl:        null,
        altText:         null,
        flexPayloadJson: null,
        quickReplies:    QUICK_REPLIES_JSON,
        sortOrder:       0,
        character:       null,
      },
    ]);

    await callWebhook(START_TRIGGER);

    expect(mockReplyToLine).toHaveBeenCalledOnce();

    const [, messages] = mockReplyToLine.mock.calls[0];
    // LINE message が送信されていること
    expect(messages.length).toBeGreaterThan(0);

    // 最後のテキストメッセージに quickReply が含まれること
    const textMsgs = messages.filter((m: any) => m.type === "text");
    const lastText = textMsgs[textMsgs.length - 1];
    expect(lastText).toBeDefined();
    expect(lastText.quickReply).toBeDefined();
    expect(lastText.quickReply.items).toHaveLength(2);

    // message アクション（"次へ"）
    expect(lastText.quickReply.items[0].action.type).toBe("message");
    expect(lastText.quickReply.items[0].action.label).toBe("次へ");
    expect(lastText.quickReply.items[0].action.text).toBe("次へ");

    // uri アクション（"詳細"）
    expect(lastText.quickReply.items[1].action.type).toBe("uri");
    expect(lastText.quickReply.items[1].action.label).toBe("詳細");
    expect(lastText.quickReply.items[1].action.uri).toBe("https://example.com");
  });

  it("quickReplies が null の kind=start メッセージでは quickReply なし", async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      {
        id:              "msg-start-2",
        triggerKeyword:  null,
        messageType:     "text",
        body:            "クイックリプライなしメッセージ",
        assetUrl:        null,
        altText:         null,
        flexPayloadJson: null,
        quickReplies:    null,
        sortOrder:       0,
        character:       null,
      },
    ]);

    await callWebhook(START_TRIGGER);

    expect(mockReplyToLine).toHaveBeenCalledOnce();
    const [, messages] = mockReplyToLine.mock.calls[0];
    const textMsgs = messages.filter((m: any) => m.type === "text");
    const lastText = textMsgs[textMsgs.length - 1];
    expect(lastText?.quickReply).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 2: kind="start" 0件 → フォールバックでも quickReply が含まれる
// ─────────────────────────────────────────────

describe("シナリオ 2: kind=start 0件フォールバック時も quickReply が含まれる", () => {
  it("buildRuntimeState 経由のフォールバックでも quickReply が出力される", async () => {
    // kind="start" メッセージなし → フォールバックへ
    mockPrisma.message.findMany.mockResolvedValue([]);

    // buildRuntimeState が使う phase.findUnique のモック
    mockPrisma.phase.findUnique.mockResolvedValue({
      id:        PHASE_NORMAL_ID,
      phaseType: "normal",
      name:      "通常フェーズ",
      description: null,
      messages: [
        {
          id:              "msg-normal-1",
          messageType:     "text",
          body:            "フォールバックメッセージ",
          assetUrl:        null,
          altText:         null,
          flexPayloadJson: null,
          quickReplies:    JSON.stringify([
            { label: "続ける", action: "message", value: "続ける" },
          ]),
          sortOrder:       0,
          character:       null,
          isActive:        true,
        },
      ],
      transitionsFrom: [],
    });

    await callWebhook(START_TRIGGER);

    expect(mockReplyToLine).toHaveBeenCalledOnce();
    const [, messages] = mockReplyToLine.mock.calls[0];
    const textMsgs = messages.filter((m: any) => m.type === "text");
    const lastText = textMsgs[textMsgs.length - 1];
    expect(lastText).toBeDefined();
    expect(lastText.quickReply).toBeDefined();
    expect(lastText.quickReply.items[0].action.type).toBe("message");
    expect(lastText.quickReply.items[0].action.label).toBe("続ける");
  });
});
