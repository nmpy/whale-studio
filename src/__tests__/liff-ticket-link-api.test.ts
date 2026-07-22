// src/__tests__/liff-ticket-link-api.test.ts
// link API（POST /api/liff/tickets/link）のテスト。
//   prisma / verifyLiffAccessToken / getOaFriendStatus / linkLineUserToResolvedLiveTeam を mock。
//   buildLineAddFriendUrl は実物（addFriendUrl の生成を検証）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp, mLink } = vi.hoisted(() => ({
  mp: {
    liveTicketLinkToken: { findUnique: vi.fn() },
    liveParticipant: { findFirst: vi.fn() },
    liveSession: { findMany: vi.fn(), findUnique: vi.fn() },
    liveTeam: { findMany: vi.fn(), findUnique: vi.fn() },
    oa: { findUnique: vi.fn() },
    work: { findUnique: vi.fn() },
  },
  mLink: { verify: vi.fn(), friend: vi.fn(), link: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));
vi.mock("@/lib/liff/session", () => ({ verifyLiffAccessToken: mLink.verify }));
vi.mock("@/lib/line-friend", async (orig) => ({
  ...(await orig<typeof import("@/lib/line-friend")>()),
  getOaFriendStatus: mLink.friend,
}));
vi.mock("@/lib/live-participant-link", () => ({ linkLineUserToResolvedLiveTeam: mLink.link }));

import { POST as linkPost } from "@/app/api/liff/tickets/link/route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/liff/tickets/link", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const TOK = "x".repeat(43);

const recActive = {
  id: "tok1", oaId: "oa1", workId: "w1", origin: "UZU_PRO" as "NATIVE" | "UZU_PRO", reservationNumber: "R-100", ticketId: "BEL-123456",
  liveSessionId: null as string | null, teamId: null as string | null,
  expiresAt: new Date(Date.now() + 86400000), revokedAt: null as Date | null,
};

function setHappy() {
  mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive });
  mLink.verify.mockResolvedValue({ ok: true, lineUserId: "Uverified", displayName: "太郎" });
  mp.liveParticipant.findFirst.mockResolvedValue(null);
  mp.liveSession.findMany.mockResolvedValue([{ id: "s1", name: "公演A", startsAt: new Date("2026-08-20T09:00:00Z") }]);
  mp.liveTeam.findMany.mockResolvedValue([{ id: "t1", reservationNumber: "R-100", ticketId: "BEL-123456", liveSessionId: "s1", groupType: "four", reservedAt: null }]);
  mp.oa.findUnique.mockResolvedValue({ channelAccessToken: "cat", lineOaId: "613zlngs" });
  mLink.friend.mockResolvedValue({ kind: "friend" });
  mLink.link.mockResolvedValue({ kind: "linked", created: true, participantId: "p1" });
  mp.work.findUnique.mockResolvedValue({ title: "作品X" });
}

beforeEach(() => { vi.clearAllMocks(); });

describe("link API — 本人確認", () => {
  it("accessToken 無しは ACCESS_TOKEN_REQUIRED(401)・連携しない", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive });
    mLink.verify.mockResolvedValue({ ok: false, reason: "missing_access_token" });
    const res = await linkPost(req({ token: TOK }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("ACCESS_TOKEN_REQUIRED");
    expect(mLink.link).not.toHaveBeenCalled();
  });
  it("偽/無効 accessToken は ACCESS_TOKEN_INVALID(401)・連携しない", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive });
    mLink.verify.mockResolvedValue({ ok: false, reason: "token_invalid" });
    const res = await linkPost(req({ token: TOK, accessToken: "FAKE" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("ACCESS_TOKEN_INVALID");
    expect(mLink.link).not.toHaveBeenCalled();
  });
  it("LINE プロフィール API 通信失敗は NETWORK_ERROR(503)・再試行可能・恒久変更なし", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive });
    mLink.verify.mockResolvedValue({ ok: false, reason: "request_failed" });
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.error.code).toBe("NETWORK_ERROR");
    expect(json.retryable).toBe(true);
    expect(mLink.link).not.toHaveBeenCalled();
  });
  it("token が無ければ TOKEN_NOT_FOUND(404)（verify 前に返す）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(null);
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(res.status).toBe(404);
    expect(mLink.verify).not.toHaveBeenCalled();
  });
  it("クライアント申告 lineUserId は無視し、サーバー検証済み lineUserId で連携する", async () => {
    setHappy();
    await linkPost(req({ token: TOK, accessToken: "x", lineUserId: "ATTACKER" }));
    expect(mLink.link).toHaveBeenCalledWith(expect.objectContaining({ lineUserId: "Uverified" }));
  });
});

describe("link API — 友だち状態", () => {
  it("未追加は FRIEND_REQUIRED + addFriendUrl・participant 非作成・token 不変", async () => {
    setHappy();
    mLink.friend.mockResolvedValue({ kind: "not_friend" });
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    const json = await res.json();
    expect(json.error.code).toBe("FRIEND_REQUIRED");
    expect(json.retryable).toBe(true);
    expect(json.addFriendUrl).toBe("https://line.me/R/ti/p/@613zlngs");
    expect(mLink.link).not.toHaveBeenCalled(); // participant/event/token を触らない
  });
  it("lineOaId 未設定なら FRIEND_REQUIRED + addFriendUrl:null", async () => {
    setHappy();
    mp.oa.findUnique.mockResolvedValue({ channelAccessToken: "cat", lineOaId: null });
    mLink.friend.mockResolvedValue({ kind: "not_friend" });
    const json = await (await linkPost(req({ token: TOK, accessToken: "x" }))).json();
    expect(json.error.code).toBe("FRIEND_REQUIRED");
    expect(json.addFriendUrl).toBeNull();
  });
  it("友だち確認の一時失敗は NETWORK_ERROR(503)・連携しない（恒久変更なし）", async () => {
    setHappy();
    mLink.friend.mockResolvedValue({ kind: "unavailable", status: 500 });
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NETWORK_ERROR");
    expect(mLink.link).not.toHaveBeenCalled();
  });
  it("OA 設定不備(401/403)は OA_LINE_CONFIG_ERROR・未追加として扱わない", async () => {
    setHappy();
    mLink.friend.mockResolvedValue({ kind: "config_error", status: 401 });
    const json = await (await linkPost(req({ token: TOK, accessToken: "x" }))).json();
    expect(json.error.code).toBe("OA_LINE_CONFIG_ERROR");
    expect(mLink.link).not.toHaveBeenCalled();
  });
});

describe("link API — 連携・定員・期限", () => {
  it("友だち済み → 連携成功（linked・addFriendUrl 付き）", async () => {
    setHappy();
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("linked");
    expect(json.data.ticket.workTitle).toBe("作品X");
    expect(json.data.addFriendUrl).toBe("https://line.me/R/ti/p/@613zlngs");
    // 生 reservationNumber / ticketId を返さない
    const body = JSON.stringify(json);
    expect(body).not.toContain("R-100");
    expect(body).not.toContain("BEL-123456");
  });
  it("定員到達は TEAM_FULL(409)・retryable:false", async () => {
    setHappy();
    mLink.link.mockResolvedValue({ kind: "team_full" });
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("TEAM_FULL");
    expect(json.retryable).toBe(false);
  });
  it("新規ユーザー + 期限切れ token は TOKEN_EXPIRED(410)・連携しない", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive, expiresAt: new Date(Date.now() - 1000) });
    mLink.verify.mockResolvedValue({ ok: true, lineUserId: "Unew", displayName: null });
    mp.liveParticipant.findFirst.mockResolvedValue(null);
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("TOKEN_EXPIRED");
    expect(mLink.link).not.toHaveBeenCalled();
  });
  it("既連携ユーザーは期限切れ token でも冪等成功（already_linked・友だち/連携を再実行しない）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive, liveSessionId: "s1", teamId: "t1", revokedAt: new Date() });
    mLink.verify.mockResolvedValue({ ok: true, lineUserId: "Uexist", displayName: "花子" });
    mp.liveParticipant.findFirst.mockResolvedValue({ id: "pE", liveSessionId: "s1", teamId: "t1" });
    mp.liveSession.findUnique.mockResolvedValue({ name: "公演A", startsAt: new Date("2026-08-20T09:00:00Z") });
    mp.liveTeam.findUnique.mockResolvedValue({ groupType: "four", reservedAt: null });
    mp.oa.findUnique.mockResolvedValue({ lineOaId: "613zlngs" });
    mp.work.findUnique.mockResolvedValue({ title: "作品X" });
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe("already_linked");
    expect(mLink.friend).not.toHaveBeenCalled(); // 友だち確認を再実行しない
    expect(mLink.link).not.toHaveBeenCalled();
  });
  it("active セッションが無ければ WORK_NOT_ACTIVE(409)", async () => {
    setHappy();
    mp.liveSession.findMany.mockResolvedValue([]);
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("WORK_NOT_ACTIVE");
  });
  it("stale teamId が現在の解決結果と矛盾する場合は安全に拒否（TICKET_NOT_FOUND）", async () => {
    setHappy();
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive, teamId: "tOLD" });
    const res = await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TICKET_NOT_FOUND");
    expect(mLink.link).not.toHaveBeenCalled();
  });
});

describe("link API — origin 継承（共有入口・token lookup は origin で絞らない）", () => {
  // 9: LIFF link は NATIVE / UZU_PRO 両方の token を解決する（token 検索に origin フィルタを付けない）
  it("9: token lookup の where は { tokenHash } のみ（origin キーを含めない）", async () => {
    setHappy();
    await linkPost(req({ token: TOK, accessToken: "x" }));
    const where = mp.liveTicketLinkToken.findUnique.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(["tokenHash"]);
    expect("origin" in where).toBe(false);
  });
  // 10: Participant は解決した token.origin を継承する（UZU_PRO token → origin: UZU_PRO で連携）
  it("10: UZU_PRO token は origin=UZU_PRO を連携関数へ渡す", async () => {
    setHappy();
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive, origin: "UZU_PRO" });
    await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(mLink.link).toHaveBeenCalledWith(expect.objectContaining({ origin: "UZU_PRO" }));
  });
  it("10b: NATIVE token は origin=NATIVE を連携関数へ渡す（継承）", async () => {
    setHappy();
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...recActive, origin: "NATIVE" });
    await linkPost(req({ token: TOK, accessToken: "x" }));
    expect(mLink.link).toHaveBeenCalledWith(expect.objectContaining({ origin: "NATIVE" }));
  });
});
