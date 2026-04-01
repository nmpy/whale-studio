/**
 * src/__tests__/webhook-hint-quickReply.test.ts
 *
 * hint action quickReply の挙動検証
 *
 * 検証シナリオ:
 *  1. hint_text 設定済みの hint QR をタップ → ヒント本文が返信される
 *  2. hint_text 未設定の hint QR をタップ → フォールバックメッセージが返信される
 *  3. マッチしないテキスト → hint ではなく通常フロー（matchTransition へ）
 *  4. value 設定なし（label でマッチ） → hint_text が返信される
 *  5. NFKC 正規化マッチ（全角 "ｈｉｎｔ１" → "hint1"）
 *  6. 既存の text / url / next / custom action に hint_text がないこと（後方互換）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────
//  モック
// ─────────────────────────────────────────────

const mockPrisma = {
  oa:            { findFirst: vi.fn() },
  work:          { findFirst: vi.fn(), findMany: vi.fn() },
  richMenu:      { findFirst: vi.fn() },
  phase:         { findFirst: vi.fn(), findUnique: vi.fn() },
  userProgress:  { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  message:       { findMany: vi.fn() },
  tracking:      { findMany: vi.fn() },
  trackingEvent: { findFirst: vi.fn() },
  userTracking:  { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

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
  findActiveWork:  vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/sheets-scenario", () => ({
  handleTextEventSheets:      vi.fn(),
  handlePostbackEventSheets:  vi.fn(),
  buildSystemSenderFromSheets: vi.fn(),
}));
vi.mock("@/lib/rbac", () => ({
  requireRole:       vi.fn(),
  getOaIdFromWorkId: vi.fn(),
}));

// ─────────────────────────────────────────────
//  フィクスチャ
// ─────────────────────────────────────────────

const OA_ID        = "oa-uuid-hint";
const WORK_ID      = "work-uuid-hint";
const PHASE_ID     = "phase-uuid-hint";
const PROGRESS_ID  = "progress-uuid-hint";
const USER_ID      = "U_hint_user";

const mockOa = {
  id: OA_ID, title: "ヒントOA", lineOaId: "hintoa",
  channelId: "dummy", channelSecret: "secret", channelAccessToken: "token",
  spreadsheetId: null,
};

const mockWork = {
  id: WORK_ID, title: "ヒントテスト作品",
  publishStatus: "active", sortOrder: 0,
  welcomeMessage: null, systemCharacter: null,
};

const mockProgress = {
  id: PROGRESS_ID, lineUserId: USER_ID, workId: WORK_ID,
  currentPhaseId: PHASE_ID, reachedEnding: false,
  flags: "{}", lastInteractedAt: new Date(),
};

const mockCurrentPhase = {
  id: PHASE_ID, phaseType: "normal",
  transitionsFrom: [],
};

/** quickReplies を JSON 文字列として持つメッセージを生成する */
function makeMessageWithHint(items: object[]) {
  return [{ id: "msg-hint-1", quickReplies: JSON.stringify(items) }];
}

function makeWebhookBody(text: string) {
  return JSON.stringify({
    destination: "Utest",
    events: [{
      type: "message", replyToken: "rtoken",
      source: { userId: USER_ID, type: "user" },
      message: { type: "text", text },
    }],
  });
}

async function callWebhook(text: string) {
  const { POST } = await import("@/app/api/line/[oaId]/webhook/route");
  const body = makeWebhookBody(text);
  const req  = new Request(`http://localhost/api/line/${mockOa.lineOaId}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "dummy" },
    body,
  });
  return POST(req as unknown as import("next/server").NextRequest, { params: { oaId: mockOa.lineOaId } });
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
  mockPrisma.phase.findFirst.mockResolvedValue(null); // startTrigger なし
  mockPrisma.phase.findUnique.mockResolvedValue(mockCurrentPhase);
  mockPrisma.userProgress.findUnique.mockResolvedValue(mockProgress);
  // hint照合用のメッセージ: デフォルトは空（各テストで上書き）
  mockPrisma.message.findMany.mockResolvedValue([]);
});

// ─────────────────────────────────────────────
//  シナリオ 1: hint_text 設定済みの hint QR にマッチ → ヒント本文が返信される
// ─────────────────────────────────────────────

describe("シナリオ 1: hint_text 設定済み → ヒント本文が返信される", () => {
  it("value='hint1' にマッチして hint_text が replyToLine に渡る", async () => {
    // message.findMany が hint quick reply を返す（1回目 = hint 照合用）
    // 2回目以降は通常フロー用（triggerKeyword 照合）
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        {
          label:     "ヒント1",
          action:    "hint",
          value:     "hint1",
          hint_text: "まずは丸の数に注目してみてください。",
        },
      ]))
      .mockResolvedValue([]); // triggerKeyword 用 → マッチなし

    await callWebhook("hint1");

    expect(mockReplyToLine).toHaveBeenCalledOnce();
    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("text");
    expect(msgs[0].text).toBe("まずは丸の数に注目してみてください。");
  });

  it("label でもマッチする（value 設定なし）", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        {
          label:     "ヒント",
          action:    "hint",
          // value は省略
          hint_text: "ここに注目してください。",
        },
      ]))
      .mockResolvedValue([]);

    await callWebhook("ヒント");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs[0].text).toBe("ここに注目してください。");
  });

  it("複数ヒントが設定されていて hint2 に対応するテキストが返る", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "ヒント1の内容です。" },
        { label: "ヒント2", action: "hint", value: "hint2", hint_text: "ヒント2の内容です。より具体的な補助。" },
        { label: "ヒント3", action: "hint", value: "hint3", hint_text: "ヒント3の内容です。ほぼ答え直前。" },
      ]))
      .mockResolvedValue([]);

    await callWebhook("hint2");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs[0].text).toBe("ヒント2の内容です。より具体的な補助。");
  });
});

// ─────────────────────────────────────────────
//  シナリオ 2: hint_text 未設定 → フォールバック
// ─────────────────────────────────────────────

describe("シナリオ 2: hint_text 未設定 → フォールバックメッセージ", () => {
  it("hint_text がない hint QR にマッチするとフォールバックを返す", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        { label: "ヒント1", action: "hint", value: "hint1" }, // hint_text なし
      ]))
      .mockResolvedValue([]);

    await callWebhook("hint1");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs[0].type).toBe("text");
    expect(msgs[0].text).toContain("設定されていません");
  });
});

// ─────────────────────────────────────────────
//  シナリオ 3: マッチしないテキスト → 通常フロー
// ─────────────────────────────────────────────

describe("シナリオ 3: マッチしないテキスト → hint スキップ → 通常フロー", () => {
  it("hint QR にマッチしないと matchTransition が呼ばれる", async () => {
    const { matchTransition } = await import("@/lib/runtime");

    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "ヒント内容" },
      ]))
      .mockResolvedValue([]);

    await callWebhook("全然違うテキスト");

    // hint にマッチしない → matchTransition が呼ばれる
    expect(matchTransition).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 4: NFKC 正規化マッチ
// ─────────────────────────────────────────────

describe("シナリオ 4: NFKC 正規化でマッチ", () => {
  it("全角 'ｈｉｎｔ１' が半角 'hint1' の QR にマッチする", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "正規化でマッチ！" },
      ]))
      .mockResolvedValue([]);

    await callWebhook("ｈｉｎｔ１"); // 全角

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs[0].text).toBe("正規化でマッチ！");
  });
});

// ─────────────────────────────────────────────
//  シナリオ 5: hint QR なし → hint スキップ（通常フロー）
// ─────────────────────────────────────────────

describe("シナリオ 5: hint QR なし → hint 照合をスキップ", () => {
  it("quickReplies がないメッセージの場合は hint にマッチしない", async () => {
    const { matchTransition } = await import("@/lib/runtime");

    // hint 照合でヒットしない → message.findMany が空
    mockPrisma.message.findMany
      .mockResolvedValueOnce([]) // hint 照合 → 0件
      .mockResolvedValue([]);    // triggerKeyword 照合 → 0件

    await callWebhook("ヒント1");

    // hint にマッチしないので matchTransition まで到達する
    expect(matchTransition).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
//  シナリオ 6: 後方互換 — text / url アクションには hint_text が影響しない
// ─────────────────────────────────────────────

describe("シナリオ 6: 後方互換 — text/url action は hint 照合に影響しない", () => {
  it("action='text' の QR があっても hint 照合されない", async () => {
    const { matchTransition } = await import("@/lib/runtime");

    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        // action="text" なので hint 照合対象外
        { label: "次へ", action: "text", value: "次へ" },
      ]))
      .mockResolvedValue([]);

    // 「次へ」を送信しても hint として処理されない
    await callWebhook("次へ");

    // hint にマッチしない → matchTransition まで到達
    expect(matchTransition).toHaveBeenCalled();
    // もし replyToLine が呼ばれてもヒント本文ではない
  });
});

// ─────────────────────────────────────────────
//  シナリオ 7: enabled=false のアイテムはスキップ
// ─────────────────────────────────────────────

describe("シナリオ 7: enabled=false のアイテムはスキップされる", () => {
  it("enabled=false の hint QR にマッチしない → matchTransition が呼ばれる", async () => {
    const { matchTransition } = await import("@/lib/runtime");

    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        {
          label:     "ヒント1",
          action:    "hint",
          value:     "hint1",
          hint_text: "このヒントは無効です",
          enabled:   false, // 無効
        },
      ]))
      .mockResolvedValue([]);

    await callWebhook("hint1");

    // enabled=false なのでヒント照合をスキップ → matchTransition まで到達
    expect(matchTransition).toHaveBeenCalled();
  });

  it("enabled=true と enabled=false が混在するとき有効なほうのみマッチする", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "無効ヒント", enabled: false },
        { label: "ヒント2", action: "hint", value: "hint2", hint_text: "有効ヒントの内容です。" /* enabled 未設定=有効 */ },
      ]))
      .mockResolvedValue([]);

    await callWebhook("hint2");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs[0].text).toBe("有効ヒントの内容です。");
  });
});

// ─────────────────────────────────────────────
//  シナリオ 8: hint_followup → 2通目として送信
// ─────────────────────────────────────────────

describe("シナリオ 8: hint_followup が設定されていると 2 通目が送られる", () => {
  it("hint_followup が設定されているとき replyToLine に 2 件渡る", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        {
          label:          "ヒント1",
          action:         "hint",
          value:          "hint1",
          hint_text:      "まずは色に注目してみてください。",
          hint_followup:  "もっとヒントが欲しいときは「ヒント②」を押してね！",
        },
      ]))
      .mockResolvedValue([]);

    await callWebhook("hint1");

    expect(mockReplyToLine).toHaveBeenCalledOnce();
    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toBe("まずは色に注目してみてください。");
    expect(msgs[1].text).toBe("もっとヒントが欲しいときは「ヒント②」を押してね！");
  });

  it("hint_followup が空文字や undefined のとき 1 通のみ送られる", async () => {
    mockPrisma.message.findMany
      .mockResolvedValueOnce(makeMessageWithHint([
        {
          label:     "ヒント1",
          action:    "hint",
          value:     "hint1",
          hint_text: "ヒント本文のみ。",
          // hint_followup なし
        },
      ]))
      .mockResolvedValue([]);

    await callWebhook("hint1");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("ヒント本文のみ。");
  });
});
