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
  message:       { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  globalCommand: { findMany: vi.fn() },
  tracking:      { findMany: vi.fn() },
  trackingEvent: { findFirst: vi.fn() },
  userTracking:  { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// activeCache は always-miss（per-test の prisma モックを使わせ、テスト間のキャッシュ汚染を防ぐ）
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
// 実際の hint 合成・QR ビルダ等を使うため importOriginal で部分モックする。
// スタブ化するのは signature 検証 / 開始判定 / 送信系（reply）のみ。
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
  return {
    ...actual,
    matchTransition: vi.fn().mockReturnValue(null),
  };
});

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
  messages: [] as object[],
  transitionsFrom: [],
};

/** quickReplies を JSON 文字列として持つ phase メッセージ配列を生成する */
function makeMessageWithHint(items: object[]) {
  return [{ id: "msg-hint-1", kind: "normal", triggerKeyword: null, quickReplies: JSON.stringify(items) }];
}

/**
 * hint 用メッセージを currentPhase に載せる。
 * route は currentPhase（= getCachedPhase → fetchPhaseWithIncludes → prisma.phase.findUnique の
 * include: messages）の messages を matchHintFromPhase に渡すため、ヒントは phase.findUnique 経由で供給する。
 */
function setHintPhase(items: object[]) {
  mockPrisma.phase.findUnique.mockResolvedValue({
    ...mockCurrentPhase,
    messages: makeMessageWithHint(items),
    transitionsFrom: [],
  });
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
  mockPrisma.userProgress.update.mockResolvedValue(mockProgress);
  // hint照合用のメッセージ: デフォルトは空（各テストで上書き）
  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.globalCommand.findMany.mockResolvedValue([]); // グローバルコマンドなし
});

// ─────────────────────────────────────────────
//  シナリオ 1: hint_text 設定済みの hint QR にマッチ → ヒント本文が返信される
// ─────────────────────────────────────────────

describe("シナリオ 1: hint_text 設定済み → ヒント本文が返信される", () => {
  it("value='hint1' にマッチして hint_text が replyToLine に渡る", async () => {
    // hint QR は currentPhase.messages（phase.findUnique の include）経由で供給する
    setHintPhase([
        {
          label:     "ヒント1",
          action:    "hint",
          value:     "hint1",
          hint_text: "まずは丸の数に注目してみてください。",
        },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]); // triggerKeyword 用 → マッチなし

    await callWebhook("hint1");

    expect(mockReplyToLine).toHaveBeenCalledOnce();
    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("text");
    expect(msgs[0].text).toBe("まずは丸の数に注目してみてください。");
  });

  it("label でもマッチする（value 設定なし）", async () => {
    setHintPhase([
        {
          label:     "ヒント",
          action:    "hint",
          // value は省略
          hint_text: "ここに注目してください。",
        },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

    await callWebhook("ヒント");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs[0].text).toBe("ここに注目してください。");
  });

  it("複数ヒントが設定されていて hint2 に対応するテキストが返る", async () => {
    setHintPhase([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "ヒント1の内容です。" },
        { label: "ヒント2", action: "hint", value: "hint2", hint_text: "ヒント2の内容です。より具体的な補助。" },
        { label: "ヒント3", action: "hint", value: "hint3", hint_text: "ヒント3の内容です。ほぼ答え直前。" },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

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
    setHintPhase([
        { label: "ヒント1", action: "hint", value: "hint1" }, // hint_text なし
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

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

    setHintPhase([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "ヒント内容" },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

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
    setHintPhase([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "正規化でマッチ！" },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

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

    setHintPhase([
        // action="text" なので hint 照合対象外
        { label: "次へ", action: "text", value: "次へ" },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

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

    setHintPhase([
        {
          label:     "ヒント1",
          action:    "hint",
          value:     "hint1",
          hint_text: "このヒントは無効です",
          enabled:   false, // 無効
        },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

    await callWebhook("hint1");

    // enabled=false なのでヒント照合をスキップ → matchTransition まで到達
    expect(matchTransition).toHaveBeenCalled();
  });

  it("enabled=true と enabled=false が混在するとき有効なほうのみマッチする", async () => {
    setHintPhase([
        { label: "ヒント1", action: "hint", value: "hint1", hint_text: "無効ヒント", enabled: false },
        { label: "ヒント2", action: "hint", value: "hint2", hint_text: "有効ヒントの内容です。" /* enabled 未設定=有効 */ },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

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
    setHintPhase([
        {
          label:          "ヒント1",
          action:         "hint",
          value:          "hint1",
          hint_text:      "まずは色に注目してみてください。",
          hint_followup:  "もっとヒントが欲しいときは「ヒント②」を押してね！",
        },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

    await callWebhook("hint1");

    expect(mockReplyToLine).toHaveBeenCalledOnce();
    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toBe("まずは色に注目してみてください。");
    expect(msgs[1].text).toBe("もっとヒントが欲しいときは「ヒント②」を押してね！");
  });

  it("hint_followup が空文字や undefined のとき 1 通のみ送られる", async () => {
    setHintPhase([
        {
          label:     "ヒント1",
          action:    "hint",
          value:     "hint1",
          hint_text: "ヒント本文のみ。",
          // hint_followup なし
        },
    ]);
    mockPrisma.message.findMany.mockResolvedValue([]);

    await callWebhook("hint1");

    const [, msgs] = mockReplyToLine.mock.calls[0];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("ヒント本文のみ。");
  });
});
