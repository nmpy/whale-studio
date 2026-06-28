/**
 * src/__tests__/webhook-quickReply-postback.test.ts
 *
 * 通常 QR postback（action=quick_reply&sourceMessageId=...&qrIndex=...）の webhook 統合検証。
 *
 * ★ 必須 regression（スクリーンショットの不具合）:
 *   - 同一フェーズに同名「次へ」が 2 つ（A:次へ→B / B:次へ→C）。
 *   - メッセージ B 下の「次へ」をタップした postback を受けたとき、送信先 C が送られる。
 *   - メッセージ B が再送されない（ラベル一致 matchQrItem の取り違えが解消される）。
 *
 * + fallback: postback でない text event（「次へ」手入力 / 旧 message action QR）は従来どおり
 *   matchQrItem のラベル一致経路が動く。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  oa:            { findFirst: vi.fn() },
  work:          { findFirst: vi.fn(), findMany: vi.fn() },
  richMenu:      { findFirst: vi.fn() },
  phase:         { findFirst: vi.fn(), findUnique: vi.fn() },
  userProgress:  { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  message:       { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  globalCommand: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

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

const mockReplyToLine = vi.fn().mockResolvedValue(undefined);
const mockReplyWithLagToLine = vi.fn().mockResolvedValue(undefined);
// 実際の buildQuickReplyFromItems / buildMessageChain / 解決ロジックを使う。送信系だけスタブ。
vi.mock("@/lib/line", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/line")>();
  return {
    ...actual,
    verifyLineSignature: vi.fn().mockReturnValue(true),
    isStartCommand:      vi.fn().mockReturnValue(false),
    isStartIntent:       vi.fn().mockReturnValue(false),
    isResetCommand:      vi.fn().mockReturnValue(false),
    isContinueCommand:   vi.fn().mockReturnValue(false),
    replyToLine:         mockReplyToLine,
    replyWithLagToLine:  mockReplyWithLagToLine,
  };
});
vi.mock("@/lib/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runtime")>();
  return { ...actual, matchTransition: vi.fn().mockReturnValue(null) };
});
vi.mock("@/lib/line-richmenu", () => ({ linkRichMenuToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/sheets-db", () => ({ loadSheetsData: vi.fn(), findActiveWork: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/sheets-scenario", () => ({
  handleTextEventSheets: vi.fn(), handlePostbackEventSheets: vi.fn(), buildSystemSenderFromSheets: vi.fn(),
}));
vi.mock("@/lib/rbac", () => ({ requireRole: vi.fn(), getOaIdFromWorkId: vi.fn() }));

const OA_ID = "oa-uuid-qr", WORK_ID = "work-uuid-qr", PHASE_ID = "phase-uuid-qr";
const PROGRESS_ID = "progress-uuid-qr", USER_ID = "U_qr_user";

const mockOa = {
  id: OA_ID, title: "QR OA", lineOaId: "qroa",
  channelId: "dummy", channelSecret: "secret", channelAccessToken: "token", spreadsheetId: null,
};
const mockWork = {
  id: WORK_ID, title: "QRテスト作品", publishStatus: "active", sortOrder: 0,
  welcomeMessage: null, systemCharacter: null,
};
const mockProgress = {
  id: PROGRESS_ID, lineUserId: USER_ID, workId: WORK_ID,
  currentPhaseId: PHASE_ID, reachedEnding: false, flags: "{}",
  lastSentMessageIds: null, waitingForInput: null, variables: null, lastInteractedAt: new Date(),
};

// A:「次へ」→ B / B:「次へ」→ C（同名「次へ」）。phase に両方を載せる。
const QR_NEXT = (targetId: string) =>
  JSON.stringify([{ action: "text", label: "次へ", target_type: "message", target_message_id: targetId }]);

const msgA = { id: "msg-A", kind: "normal", hintMode: "always", quickReplies: QR_NEXT("msg-B"), incorrectQuickReplies: null, triggerKeyword: null };
const msgB = { id: "msg-B", kind: "normal", hintMode: "always", quickReplies: QR_NEXT("msg-C"), incorrectQuickReplies: null, triggerKeyword: null };

const mockPhase = {
  id: PHASE_ID, phaseType: "normal",
  messages: [msgA, msgB],
  transitionsFrom: [],
};

// target 送信先メッセージ C（buildMessageChain が findUnique で取得する形）。
const targetMsgC = {
  id: "msg-C", messageType: "text", body: "メッセージCの本文（先に進んだ証拠）", assetUrl: null,
  altText: null, flexPayloadJson: null, quickReplies: null, nextMessageId: null, sortOrder: 0,
  kind: "normal", hintMode: "always", incorrectQuickReplies: null,
  imageActionType: null, imageActionText: null, imageActionUrl: null, imageActionLiffPageId: null, imageActionPostbackData: null,
  freeInputEnabled: false, lagMs: 0,
  readReceiptMode: null, readDelayMs: null, typingEnabled: false, typingMinMs: null, typingMaxMs: null,
  loadingEnabled: false, loadingThresholdMs: null, loadingMinSeconds: null, loadingMaxSeconds: null,
  character: null,
};
const targetMsgB = { ...targetMsgC, id: "msg-B", body: "メッセージBの本文（再送されたら不具合）" };

function makePostbackBody(data: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{
      type: "postback", replyToken: "rtoken",
      source: { userId: USER_ID, type: "user" },
      postback: { data },
    }],
  });
}
function makeTextBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{
      type: "message", replyToken: "rtoken",
      source: { userId: USER_ID, type: "user" },
      message: { type: "text", text },
    }],
  });
}
async function callWebhook(body: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const req = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "dummy" },
    body,
  });
  return POST(req as unknown as import("next/server").NextRequest, { params: { oaId: mockOa.lineOaId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.work.findMany.mockResolvedValue([mockWork]);
  mockPrisma.work.findFirst.mockResolvedValue(mockWork);
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findUnique.mockResolvedValue(mockPhase);
  mockPrisma.userProgress.findUnique.mockResolvedValue(mockProgress);
  mockPrisma.userProgress.update.mockResolvedValue(mockProgress);
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]);
});

describe("★ regression: メッセージ B 下の『次へ』postback → 送信先 C が送られ、B は再送されない", () => {
  it("quick_reply postback(sourceMessageId=msg-B, qrIndex=0) → msg-C を送信", async () => {
    // findUnique は (1) sourceMessage(msg-B) 取得 → (2) target(msg-C) 取得 の順で呼ばれる。
    mockPrisma.message.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "msg-B") return msgB;       // sourceMessage 解決
      if (where.id === "msg-C") return targetMsgC; // target_message 取得
      if (where.id === "msg-A") return msgA;
      return null;
    });

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-B&qrIndex=0"));

    // target_message パスは replyWithLagToLine で送信される。
    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    const sent = mockReplyWithLagToLine.mock.calls[0][1] as { type: string; text?: string }[];
    const bodies = sent.map((m) => m.text);
    expect(bodies).toContain("メッセージCの本文（先に進んだ証拠）");
    // ★ B（タップ元メッセージ）が再送されていないこと
    expect(bodies).not.toContain("メッセージBの本文（再送されたら不具合）");
  });

  it("メッセージ A 下の『次へ』postback(sourceMessageId=msg-A) → 送信先 B が送られる", async () => {
    mockPrisma.message.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "msg-A") return msgA;
      if (where.id === "msg-B") return targetMsgB; // A の送信先は B
      return null;
    });

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-A&qrIndex=0"));

    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    const sent = mockReplyWithLagToLine.mock.calls[0][1] as { text?: string }[];
    expect(sent.map((m) => m.text)).toContain("メッセージBの本文（再送されたら不具合）");
  });
});

describe("不正な postback は安全に無視（例外なし・何も送らない）", () => {
  it("sourceMessage が存在しない → 何も送らない", async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=does-not-exist&qrIndex=0"));
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(mockReplyToLine).not.toHaveBeenCalled();
  });

  it("qrIndex が範囲外 → 何も送らない", async () => {
    mockPrisma.message.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "msg-B" ? msgB : null);
    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-B&qrIndex=99"));
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });
});

describe("fallback: postback でない text event は従来の matchQrItem ラベル一致が動く", () => {
  it("「次へ」を手入力 → matchQrItem 経由で target が送られる（postback 不要の旧経路維持）", async () => {
    // frontier=null（progress.lastSentMessageIds=null）→ matchQrItem は phase 全体を走査。
    // 先頭一致で msg-A の「次へ」→ 送信先 msg-B が解決される（従来挙動）。
    mockPrisma.message.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "msg-B" ? targetMsgB : null);

    await callWebhook(makeTextBody("次へ"));

    // text fallback でも target_message パス（replyWithLagToLine）で送信される。
    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    const sent = mockReplyWithLagToLine.mock.calls[0][1] as { text?: string }[];
    expect(sent.map((m) => m.text)).toContain("メッセージBの本文（再送されたら不具合）");
  });
});
