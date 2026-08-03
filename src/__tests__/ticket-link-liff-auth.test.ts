// src/__tests__/ticket-link-liff-auth.test.ts
//
// チケット連携 LIFF API の認証・認可。
// クライアント申告値を認可に使わないこと、OA / チャネル束縛が効くことを検証する。

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockVerify, mockFriend, mockBind } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFriend: vi.fn(),
  mockBind: vi.fn(),
}));
vi.mock("@/lib/liff/session", () => ({
  verifyLiffAccessToken: mockVerify,
  LIFF_SESSION_USER_ERROR: "LINE連携に失敗しました。もう一度開き直してください。",
}));
vi.mock("@/lib/line-friend", () => ({ getOaFriendStatus: mockFriend }));
vi.mock("@/lib/ticket-link/token-channel", () => ({ verifyTokenIssuedForOaChannel: mockBind }));

import {
  authenticateTicketLinkRequest,
  assertTicketLinkPageBelongsToWork,
  authFailureStatus,
  authFailureMessage,
} from "@/lib/ticket-link/auth";

const ENABLED = {
  ticket_link: {
    enabled: true,
    manualInputEnabled: true,
    ticketTypes: [{ ticketTypeKey: "single", ticketTypeLabel: "1名", participantCount: 1, enabled: true, sortOrder: 0 }],
  },
};

function makeDb(work: unknown, page: unknown = null) {
  return {
    work: { findFirst: vi.fn().mockResolvedValue(work) },
    liffPageConfig: { findFirst: vi.fn().mockResolvedValue(page) },
  } as never;
}

const WORK = {
  id: "w1",
  oaId: "oa1",
  liffHomeSettingsJson: ENABLED,
  oa: { id: "oa1", liffId: "liff-1", channelId: "ch-1", channelAccessToken: "cat-1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue({ ok: true, lineUserId: "U1", displayName: "たろう" });
  mockFriend.mockResolvedValue({ kind: "friend" });
  mockBind.mockResolvedValue({ kind: "ok", clientId: "1234567890" });
});

describe("authenticateTicketLinkRequest", () => {
  it("トークン検証に失敗したら unauthorized（DB を引かない）", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "token_invalid" });
    const db = makeDb(WORK);
    const r = await authenticateTicketLinkRequest(db, { accessToken: "bad", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "unauthorized" } });
    expect((db as never as { work: { findFirst: ReturnType<typeof vi.fn> } }).work.findFirst).not.toHaveBeenCalled();
  });

  it("サーバー検証済みの lineUserId を返す（クライアント申告は使わない）", async () => {
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.lineUserId).toBe("U1");
      expect(r.ctx.oaId).toBe("oa1");
      expect(r.ctx.channelId).toBe("ch-1");
      expect(r.ctx.liffId).toBe("liff-1");
    }
  });

  it("OA は Work から導出する（クライアントの oaId を受け取らない）", async () => {
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r.ok).toBe(true);
    // 引数に oaId / channelId を渡す口が無いことは型で保証されるため、導出結果のみ検証する。
    if (r.ok) expect(r.ctx.oaId).toBe("oa1");
  });

  it("存在しない作品は not_found", async () => {
    const r = await authenticateTicketLinkRequest(makeDb(null), { accessToken: "t", workIdOrPublicId: "nope" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "not_found" } });
  });

  it("チケット連携が無効な作品は存在秘匿で not_found", async () => {
    const r = await authenticateTicketLinkRequest(
      makeDb({ ...WORK, liffHomeSettingsJson: {} }),
      { accessToken: "t", workIdOrPublicId: "w1" },
    );
    expect(r).toMatchObject({ ok: false, failure: { kind: "not_found" } });
    // 設定が無効なら friend 判定まで進まない。
    expect(mockFriend).not.toHaveBeenCalled();
  });

  it("手動入力が無効なら書き込み系は not_found", async () => {
    const settings = { ticket_link: { ...ENABLED.ticket_link, manualInputEnabled: false } };
    const r = await authenticateTicketLinkRequest(
      makeDb({ ...WORK, liffHomeSettingsJson: settings }),
      { accessToken: "t", workIdOrPublicId: "w1", requireManualInput: true },
    );
    expect(r).toMatchObject({ ok: false, failure: { kind: "not_found" } });
  });

  it("チケット種別が 0 件なら書き込み系は not_found（fail closed）", async () => {
    const settings = { ticket_link: { ...ENABLED.ticket_link, ticketTypes: [] } };
    const r = await authenticateTicketLinkRequest(
      makeDb({ ...WORK, liffHomeSettingsJson: settings }),
      { accessToken: "t", workIdOrPublicId: "w1", requireManualInput: true },
    );
    expect(r).toMatchObject({ ok: false, failure: { kind: "not_found" } });
  });

  it("対象 OA の友だちでなければ続行しない（OA 束縛）", async () => {
    mockFriend.mockResolvedValue({ kind: "not_friend" });
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "friend_required" } });
  });

  it("friend 判定は対象 OA の channelAccessToken で行う（テナント越境しない）", async () => {
    await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(mockFriend).toHaveBeenCalledWith("U1", "cat-1", expect.anything());
  });

  it("OA 設定不備はユーザーの未追加として扱わない", async () => {
    mockFriend.mockResolvedValue({ kind: "config_error", status: 401 });
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "oa_config_error" } });
  });

  it("一時的な通信失敗は unavailable", async () => {
    mockFriend.mockResolvedValue({ kind: "unavailable", status: 500 });
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });
});

describe("発行先チャネルの束縛（strict）", () => {
  it("別チャネル発行のトークンは拒否する（流用防止）", async () => {
    mockBind.mockResolvedValue({ kind: "channel_mismatch" });
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "channel_mismatch" } });
    // チャネル不一致なら friend 判定まで進まない。
    expect(mockFriend).not.toHaveBeenCalled();
  });

  it("期待チャネルを判定できない場合も fail closed", async () => {
    mockBind.mockResolvedValue({ kind: "expected_channel_unknown" });
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "channel_mismatch" } });
  });

  it("検証は対象 OA の liffId に対して行う", async () => {
    await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(mockBind).toHaveBeenCalledWith("t", "liff-1", expect.anything());
  });

  it("トークン無効は unauthorized", async () => {
    mockBind.mockResolvedValue({ kind: "token_invalid" });
    const r = await authenticateTicketLinkRequest(makeDb(WORK), { accessToken: "t", workIdOrPublicId: "w1" });
    expect(r).toMatchObject({ ok: false, failure: { kind: "unauthorized" } });
  });

  it("チャネル不一致の文言は技術的詳細を出さない", () => {
    const msg = authFailureMessage({ kind: "channel_mismatch" });
    expect(msg).not.toMatch(/channel|client_id|liff/i);
    expect(authFailureStatus({ kind: "channel_mismatch" })).toBe(401);
  });
});

describe("assertTicketLinkPageBelongsToWork", () => {
  it("対象 Work に属する公開ページのみ true", async () => {
    const db = makeDb(WORK, { id: "p1" });
    expect(await assertTicketLinkPageBelongsToWork(db, "w1", "p1")).toBe(true);
    const call = (db as never as { liffPageConfig: { findFirst: ReturnType<typeof vi.fn> } }).liffPageConfig.findFirst.mock.calls[0][0];
    expect(call.where.workId).toBe("w1");
    expect(call.where.pageType).toBe("ticket_link");
    expect(call.where.isEnabled).toBe(true);
  });

  it("別 Work のページ ID は通さない", async () => {
    expect(await assertTicketLinkPageBelongsToWork(makeDb(WORK, null), "w1", "p-other")).toBe(false);
  });
});

describe("失敗の外部表現", () => {
  it("存在秘匿のため not_found は 404", () => {
    expect(authFailureStatus({ kind: "not_found" })).toBe(404);
    expect(authFailureStatus({ kind: "unauthorized" })).toBe(401);
    expect(authFailureStatus({ kind: "friend_required" })).toBe(403);
  });

  it("文言に予約・他ユーザーの情報を含めない", () => {
    for (const kind of ["unauthorized", "not_found", "friend_required", "channel_mismatch", "oa_config_error", "unavailable"] as const) {
      const msg = authFailureMessage({ kind } as never);
      expect(msg).not.toMatch(/予約番号|U[0-9a-f]{8}/);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
