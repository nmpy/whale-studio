/**
 * src/__tests__/webhook-service-suspended.test.ts
 *
 * OA.serviceSuspendedAt が非 null のとき、LINE webhook が通常処理を行わず
 * 一律「サービス終了」メッセージで応答する挙動を検証する。
 *
 * 検証シナリオ:
 *  1. 停止中 OA + text message → 一律「サービス終了」テキストで reply
 *  2. 停止中 OA では通常の作品応答処理 (startTrigger / keyword / phase 等) に進まない
 *  3. 稼働中 OA (serviceSuspendedAt: null) → 既存どおり通常処理が走る
 *  4. 停止中 OA + postback / follow / beacon → reply されず 200 OK のみ
 *  5. 署名検証は停止判定より先に走る (= 検証失敗時は reply されない)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────
//  外部依存モック
// ─────────────────────────────────────────────

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

// 署名検証は既定で成功させる。失敗ケースは個別テスト内で override する。
const mockVerifyLineSignature = vi.fn().mockReturnValue(true);
const mockReplyToLine = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/line", () => ({
  verifyLineSignature:  mockVerifyLineSignature,
  isStartCommand:       vi.fn().mockReturnValue(false),
  isResetCommand:       vi.fn().mockReturnValue(false),
  isContinueCommand:    vi.fn().mockReturnValue(false),
  replyToLine:          mockReplyToLine,
  buildPhaseMessages:   vi.fn().mockReturnValue([{ type: "text", text: "phase-msg" }]),
  buildQuickReply:      vi.fn().mockReturnValue(undefined),
  buildKeywordMessages: vi.fn().mockReturnValue([{ type: "text", text: "kw-msg" }]),
  RICHMENU_ACTIONS:     { START: "start", RESET: "reset", CONTINUE: "continue" },
}));

vi.mock("@/lib/runtime", () => ({
  buildRuntimeState: vi.fn().mockResolvedValue({ phase: { id: "p1", messages: [], transitions: [] } }),
  matchTransition:   vi.fn().mockReturnValue(null),
  applySetFlags:     vi.fn().mockReturnValue({}),
  safeParseFlags:    vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/line-richmenu", () => ({
  linkRichMenuToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sheets-db", () => ({
  loadSheetsData: vi.fn(),
  findActiveWork: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/sheets-scenario", () => ({
  handleTextEventSheets:       vi.fn(),
  handlePostbackEventSheets:   vi.fn(),
  buildSystemSenderFromSheets: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireRole:       vi.fn(),
  getOaIdFromWorkId: vi.fn(),
}));

// ─────────────────────────────────────────────
//  フィクスチャ
// ─────────────────────────────────────────────

const OA_ID    = "oa-uuid-1";
const USER_ID  = "U_suspend_test";
const REPLY_TOKEN = "reply-token-suspended";

const SUSPENDED_REPLY_TEXT = "このアカウントのサービスは終了しました。ご利用ありがとうございました。";

// 各 describe で別の lineOaId を使い、webhook 内 activeCache の OA キャッシュ
// (= lineOaId キー) が他テストに漏れないようにする。
function makeOa(opts: { lineOaId: string; serviceSuspendedAt: Date | null }) {
  return {
    id:                 OA_ID,
    title:              "停止判定テスト OA",
    lineOaId:           opts.lineOaId,
    channelId:          "dummy",
    channelSecret:      "secret",
    channelAccessToken: "token",
    spreadsheetId:      null,
    publishStatus:      "active",
    serviceSuspendedAt: opts.serviceSuspendedAt,
  };
}

function makeTextWebhookBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{
      type:       "message",
      replyToken: REPLY_TOKEN,
      source:     { userId: USER_ID, type: "user" },
      message:    { type: "text", text },
    }],
  });
}

function makePostbackWebhookBody(data: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{
      type:       "postback",
      replyToken: REPLY_TOKEN,
      source:     { userId: USER_ID, type: "user" },
      postback:   { data },
    }],
  });
}

function makeFollowWebhookBody() {
  return JSON.stringify({
    destination: "Utest",
    events: [{
      type:       "follow",
      replyToken: REPLY_TOKEN,
      source:     { userId: USER_ID, type: "user" },
    }],
  });
}

async function callWebhook(lineOaId: string, body: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${lineOaId}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "dummy" },
    body,
  });
  return POST(req as Parameters<typeof POST>[0], { params: { oaId: lineOaId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyLineSignature.mockReturnValue(true);
  // 他テストとの共有 OA キャッシュ汚染を避けるため毎回新しい OA を返す。
  mockPrisma.work.findMany.mockResolvedValue([]);
  mockPrisma.work.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(null);
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.userProgress.findUnique.mockResolvedValue(null);
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
});

// ─────────────────────────────────────────────
//  シナリオ 1: 停止中 OA に text → 一律サービス終了メッセージで reply
// ─────────────────────────────────────────────

describe("シナリオ 1: 停止中 OA に text message が来ると一律「サービス終了」で返信される", () => {
  it("replyToLine がサービス終了テキストで呼ばれる", async () => {
    const oa = makeOa({ lineOaId: "suspended-text-oa", serviceSuspendedAt: new Date("2026-06-01T00:00:00.000Z") });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);

    const res = await callWebhook(oa.lineOaId, makeTextWebhookBody("こんにちは"));

    expect(res.status).toBe(200);
    expect(mockReplyToLine).toHaveBeenCalledTimes(1);
    expect(mockReplyToLine).toHaveBeenCalledWith(
      REPLY_TOKEN,
      [{ type: "text", text: SUSPENDED_REPLY_TEXT }],
      oa.channelAccessToken,
    );
  });
});

// ─────────────────────────────────────────────
//  シナリオ 2: 停止中 OA では通常処理に進まない
// ─────────────────────────────────────────────

describe("シナリオ 2: 停止中 OA では通常の作品応答処理に進まない", () => {
  it("startTrigger 用 phase 検索 / work 検索 / userProgress 操作が行われない", async () => {
    const oa = makeOa({ lineOaId: "suspended-bypass-oa", serviceSuspendedAt: new Date() });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);

    await callWebhook(oa.lineOaId, makeTextWebhookBody("何か発言"));

    // 通常処理パスへの分岐が一切走らないことを確認
    expect(mockPrisma.work.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.phase.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.userProgress.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.userProgress.upsert).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 3: 稼働中 OA は既存どおり通常処理が走る
// ─────────────────────────────────────────────

describe("シナリオ 3: 稼働中 OA (serviceSuspendedAt: null) では既存通り通常処理される", () => {
  it("サービス終了テキストでは reply されず、通常処理側の work 検索が走る", async () => {
    const oa = makeOa({ lineOaId: "active-oa", serviceSuspendedAt: null });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);

    await callWebhook(oa.lineOaId, makeTextWebhookBody("通常テキスト"));

    // サービス終了テキストでは呼ばれていない
    const suspendedCall = mockReplyToLine.mock.calls.find(
      (c) => Array.isArray(c[1]) && c[1][0]?.text === SUSPENDED_REPLY_TEXT
    );
    expect(suspendedCall).toBeUndefined();
    // 通常処理側に進んでいる (= fetchActiveWork → prisma.work.findFirst が呼ばれる)
    expect(mockPrisma.work.findFirst).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 4: 停止中 OA + postback / follow → reply されず 200 OK のみ
// ─────────────────────────────────────────────

describe("シナリオ 4: 停止中 OA で message 以外のイベントは reply されず 200 OK", () => {
  it("postback イベントは reply されない", async () => {
    const oa = makeOa({ lineOaId: "suspended-postback-oa", serviceSuspendedAt: new Date() });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);

    const res = await callWebhook(oa.lineOaId, makePostbackWebhookBody("action=start"));

    expect(res.status).toBe(200);
    expect(mockReplyToLine).not.toHaveBeenCalled();
  });

  it("follow イベントは reply されない (= 新規友だち追加時にサービス終了案内を送らない)", async () => {
    const oa = makeOa({ lineOaId: "suspended-follow-oa", serviceSuspendedAt: new Date() });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);

    const res = await callWebhook(oa.lineOaId, makeFollowWebhookBody());

    expect(res.status).toBe(200);
    expect(mockReplyToLine).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 5: 署名検証は停止判定より先に走る (security 順序保証)
// ─────────────────────────────────────────────

describe("シナリオ 5: 署名検証失敗時は停止中 OA でも reply されない", () => {
  it("verifyLineSignature が false を返すと、停止中であっても reply されず 200 のみ", async () => {
    const oa = makeOa({ lineOaId: "suspended-sigfail-oa", serviceSuspendedAt: new Date() });
    mockPrisma.oa.findFirst.mockResolvedValue(oa);
    mockVerifyLineSignature.mockReturnValueOnce(false);

    const res = await callWebhook(oa.lineOaId, makeTextWebhookBody("こんにちは"));

    expect(res.status).toBe(200);
    expect(mockReplyToLine).not.toHaveBeenCalled();
  });
});
