/**
 * src/__tests__/webhook-quickReply-postback.test.ts
 *
 * 通常 QR postback（action=quick_reply&sourceMessageId=...&qrIndex=...）の webhook 統合検証。
 *
 * ★ 必須 regression（スクリーンショットの不具合）:
 *   - 同一フェーズ・同一frontierに同名「次へ」が 2 つ（A:次へ→B / B:次へ→C）。
 *   - メッセージ B 下の「次へ」をタップした postback を受けたとき、送信先 C が送られる。
 *   - メッセージ B が再送されない（ラベル一致 matchQrItem の取り違えが解消される）。
 *
 * + フォローアップ修正:
 *   - waitingForInput クリア: 自由入力受付中に送信先付き QR を postback タップ → 送信先へ進み waitingForInput=null。
 *   - frontier ガード: 現在地(frontier)外の古い QR postback は無視（過去ボタン再タップ無効化）。
 *   - workId スコープ: 別 work の sourceMessageId は解決されない。
 *   - text fallback: postback でない手入力テキストは従来 matchQrItem 経路が動く。
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

const mockCacheDelete = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/cache", () => ({
  activeCache: {
    get:    vi.fn().mockResolvedValue(null),
    set:    vi.fn().mockResolvedValue(undefined),
    delete: mockCacheDelete,
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
// checkin / scheduled の arm は送信本体と無関係。DB モデル未定義なので no-op スタブ化。
vi.mock("@/lib/checkin-trigger", () => ({ armCheckinTriggers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scheduled-message-arm", () => ({ armScheduledMessages: vi.fn().mockResolvedValue(undefined) }));

const OA_ID = "oa-uuid-qr", WORK_ID = "work-uuid-qr", PHASE_ID = "phase-uuid-qr";
const PROGRESS_ID = "progress-uuid-qr", USER_ID = "U_qr_user", OTHER_WORK_ID = "work-uuid-other";

const mockOa = {
  id: OA_ID, title: "QR OA", lineOaId: "qroa",
  channelId: "dummy", channelSecret: "secret", channelAccessToken: "token", spreadsheetId: null,
};
const mockWork = {
  id: WORK_ID, title: "QRテスト作品", publishStatus: "active", sortOrder: 0,
  welcomeMessage: null, systemCharacter: null,
};

function makeProgress(overrides: Record<string, unknown> = {}) {
  return {
    id: PROGRESS_ID, lineUserId: USER_ID, workId: WORK_ID,
    currentPhaseId: PHASE_ID, reachedEnding: false, flags: "{}",
    lastSentMessageIds: null, waitingForInput: null, variables: null, lastInteractedAt: new Date(),
    ...overrides,
  };
}

// A:「次へ」→ B / B:「次へ」→ C（同名「次へ」）。
const QR_NEXT = (targetId: string) =>
  JSON.stringify([{ action: "text", label: "次へ", target_type: "message", target_message_id: targetId }]);

// 元メッセージ（src 解決用・findFirst が返す形。workId を持つ＝防御スコープ検証用）。
// triggerKeyword: null は text 経路 matchKeywordsInMemory（phase 走査）で必要。
const srcMsgA = { id: "msg-A", workId: WORK_ID, kind: "normal", hintMode: "always", quickReplies: QR_NEXT("msg-B"), incorrectQuickReplies: null, triggerKeyword: null };
const srcMsgB = { id: "msg-B", workId: WORK_ID, kind: "normal", hintMode: "always", quickReplies: QR_NEXT("msg-C"), incorrectQuickReplies: null, triggerKeyword: null };
const srcMsgPrompt = {
  id: "msg-prompt", workId: WORK_ID, kind: "normal", hintMode: "always",
  quickReplies: JSON.stringify([{ action: "text", label: "スキップ", target_type: "message", target_message_id: "msg-skip" }]),
  incorrectQuickReplies: null, triggerKeyword: null,
};
const srcMsgOtherWork = { id: "msg-otherwork", workId: OTHER_WORK_ID, kind: "normal", hintMode: "always", quickReplies: QR_NEXT("msg-C"), incorrectQuickReplies: null, triggerKeyword: null };

// 送信先メッセージ（buildMessageChain が findUnique で取得する形）。
const targetTemplate = {
  messageType: "text", assetUrl: null, altText: null, flexPayloadJson: null,
  quickReplies: null, nextMessageId: null, sortOrder: 0,
  kind: "normal", hintMode: "always", incorrectQuickReplies: null,
  imageActionType: null, imageActionText: null, imageActionUrl: null, imageActionLiffPageId: null, imageActionPostbackData: null,
  freeInputEnabled: false, lagMs: 0,
  readReceiptMode: null, readDelayMs: null, typingEnabled: false, typingMinMs: null, typingMaxMs: null,
  loadingEnabled: false, loadingThresholdMs: null, loadingMinSeconds: null, loadingMaxSeconds: null,
  character: null,
};
const targetMsgC = { ...targetTemplate, id: "msg-C", body: "メッセージCの本文（先に進んだ証拠）" };
const targetMsgB = { ...targetTemplate, id: "msg-B", body: "メッセージBの本文（再送されたら不具合）" };
const targetMsgSkip = { ...targetTemplate, id: "msg-skip", body: "スキップ先メッセージの本文" };

const mockPhase = { id: PHASE_ID, phaseType: "normal", messages: [srcMsgA, srcMsgB], transitionsFrom: [] };

/**
 * message.findFirst（src 解決・workId スコープ）と message.findUnique（target 取得）をまとめて mock。
 *  - findFirst: where.id 一致 + where.workId 一致のときだけ返す（防御スコープ再現）。
 *    applyFreeInputPostEffect の `where.id={in:[...]}` 呼び出しは string キーにならず null（free-input 無し扱い）。
 *  - findUnique: where.id 一致で返す（target 取得）。
 */
function mockMessages(srcRows: { id: string; workId: string }[], targetRows: { id: string }[]) {
  mockPrisma.message.findFirst.mockImplementation(async ({ where }: { where: { id: unknown; workId?: string } }) => {
    if (typeof where.id !== "string") return null; // applyFreeInputPostEffect の {in:[...]} は free-input 無し
    const row = srcRows.find((r) => r.id === where.id);
    if (!row) return null;
    if (where.workId !== undefined && row.workId !== where.workId) return null; // workId スコープ
    return row;
  });
  mockPrisma.message.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    targetRows.find((r) => r.id === where.id) ?? null);
}

function makePostbackBody(data: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "postback", replyToken: "rtoken", source: { userId: USER_ID, type: "user" }, postback: { data } }],
  });
}
function makeTextBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{ type: "message", replyToken: "rtoken", source: { userId: USER_ID, type: "user" }, message: { type: "text", text } }],
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
const sentBodies = () =>
  (mockReplyWithLagToLine.mock.calls[0]?.[1] as { text?: string }[] | undefined)?.map((m) => m.text) ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.oa.findFirst.mockResolvedValue(mockOa);
  mockPrisma.work.findMany.mockResolvedValue([mockWork]);
  mockPrisma.work.findFirst.mockResolvedValue(mockWork);
  mockPrisma.richMenu.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findFirst.mockResolvedValue(null);
  mockPrisma.phase.findUnique.mockResolvedValue(mockPhase);
  // frontier に A・B 両方を含む（= バグ再現の本筋: 同一frontier内に同名QRが2つ）。各テストで上書き可。
  mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: JSON.stringify(["msg-A", "msg-B"]) }));
  mockPrisma.userProgress.update.mockResolvedValue(makeProgress());
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]);
});

describe("★ regression: 同一frontier内の同名『次へ』→ タップ元 QR の送信先へ解決", () => {
  it("B下の『次へ』postback(sourceMessageId=msg-B) → msg-C 送信・msg-B 再送なし", async () => {
    mockMessages([srcMsgA, srcMsgB], [targetMsgC, targetMsgB]);
    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-B&qrIndex=0"));

    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(sentBodies()).toContain("メッセージCの本文（先に進んだ証拠）");
    expect(sentBodies()).not.toContain("メッセージBの本文（再送されたら不具合）");
  });

  it("A下の『次へ』postback(sourceMessageId=msg-A) → 送信先 B（A も frontier 内なら有効）", async () => {
    mockMessages([srcMsgA, srcMsgB], [targetMsgB]);
    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-A&qrIndex=0"));

    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(sentBodies()).toContain("メッセージBの本文（再送されたら不具合）");
  });
});

describe("frontier ガード: 現在地外の古い QR postback は無視（過去ボタン再タップ無効化）", () => {
  it("frontier=[msg-B] のとき B postback → C に進む", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: JSON.stringify(["msg-B"]) }));
    mockMessages([srcMsgA, srcMsgB], [targetMsgC]);

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-B&qrIndex=0"));

    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(sentBodies()).toContain("メッセージCの本文（先に進んだ証拠）");
  });

  it("frontier=[msg-B] のとき 古い A postback → 何も送らない（B 再送なし）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: JSON.stringify(["msg-B"]) }));
    mockMessages([srcMsgA, srcMsgB], [targetMsgB]);

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-A&qrIndex=0"));

    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(mockReplyToLine).not.toHaveBeenCalled();
    // frontier 外で弾くので src message 取得すらしない
    expect(mockPrisma.message.findFirst).not.toHaveBeenCalled();
  });

  it("frontier=null（レガシー progress）なら従来どおり許可（後方互換）", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: null }));
    mockMessages([srcMsgA, srcMsgB], [targetMsgC]);

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-B&qrIndex=0"));

    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(sentBodies()).toContain("メッセージCの本文（先に進んだ証拠）");
  });
});

describe("waitingForInput クリア: 自由入力受付中の送信先付き QR タップ", () => {
  it("『スキップ』postback → 送信先へ進み、waitingForInput=null に更新される", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({
      lastSentMessageIds: JSON.stringify(["msg-prompt"]),
      waitingForInput: JSON.stringify({ messageId: "msg-prompt", variableKey: "name", nextMessageId: null, setAt: "2026-06-29T00:00:00.000Z" }),
    }));
    mockMessages([srcMsgPrompt], [targetMsgSkip]);

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-prompt&qrIndex=0"));

    // 送信先へ進む
    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(sentBodies()).toContain("スキップ先メッセージの本文");
    // ★ waitingForInput を null にクリアする update が呼ばれている
    const clearedCall = mockPrisma.userProgress.update.mock.calls.find(
      (c) => (c[0] as { data: { waitingForInput?: unknown } }).data.waitingForInput === null,
    );
    expect(clearedCall).toBeDefined();
    // 関連キャッシュも invalidate
    expect(mockCacheDelete).toHaveBeenCalledWith(`progress:${USER_ID}:${WORK_ID}`);
  });
});

describe("workId スコープ: 別 work の sourceMessageId は解決されない", () => {
  it("別 work の message を指す postback → 何も送らない", async () => {
    // frontier=null にして frontier ガードを素通りさせ、workId スコープのみを検証する。
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: null }));
    mockMessages([srcMsgOtherWork], [targetMsgC]); // findFirst は workId=WORK_ID 条件で null を返す

    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-otherwork&qrIndex=0"));

    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(mockReplyToLine).not.toHaveBeenCalled();
  });
});

describe("不正な postback は安全に無視（例外なし・何も送らない）", () => {
  it("sourceMessage が存在しない → 何も送らない", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: null }));
    mockMessages([], []);
    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=does-not-exist&qrIndex=0"));
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
    expect(mockReplyToLine).not.toHaveBeenCalled();
  });

  it("qrIndex が範囲外 → 何も送らない", async () => {
    mockPrisma.userProgress.findUnique.mockResolvedValue(makeProgress({ lastSentMessageIds: JSON.stringify(["msg-B"]) }));
    mockMessages([srcMsgB], []);
    await callWebhook(makePostbackBody("action=quick_reply&sourceMessageId=msg-B&qrIndex=99"));
    expect(mockReplyWithLagToLine).not.toHaveBeenCalled();
  });
});

describe("fallback: postback でない text event は従来の matchQrItem ラベル一致が動く", () => {
  it("「次へ」を手入力 → matchQrItem 経由で target が送られる（postback 不要の旧経路維持）", async () => {
    // frontier に A・B 両方 → matchQrItem は先頭一致で msg-A の「次へ」→ 送信先 msg-B（従来挙動）。
    mockMessages([srcMsgA, srcMsgB], [targetMsgB]);

    await callWebhook(makeTextBody("次へ"));

    expect(mockReplyWithLagToLine).toHaveBeenCalledOnce();
    expect(sentBodies()).toContain("メッセージBの本文（再送されたら不具合）");
  });
});
