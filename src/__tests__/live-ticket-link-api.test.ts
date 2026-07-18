// src/__tests__/live-ticket-link-api.test.ts
// mint API（/api/external/v1/live/ticket-links）と resolve API（/api/liff/tickets/resolve）のテスト。
// prisma は mock。external-auth は env でキー/allowlist を設定して実物を使う。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp } = vi.hoisted(() => ({
  mp: {
    work: { findUnique: vi.fn() },
    oa: { findUnique: vi.fn() },
    liveSession: { findFirst: vi.fn(), findMany: vi.fn() },
    liveTeam: { findMany: vi.fn() },
    liveTicketLinkToken: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { POST as mintPost } from "@/app/api/external/v1/live/ticket-links/route";
import { POST as resolvePost } from "@/app/api/liff/tickets/resolve/route";

const KEY = "test-external-key";
function req(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const mintReq = (body: unknown, headers: Record<string, string> = { "x-whale-api-key": KEY }) =>
  req("http://localhost/api/external/v1/live/ticket-links", body, headers);
const resolveReq = (body: unknown) => req("http://localhost/api/liff/tickets/resolve", body);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHALE_EXTERNAL_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_WRITE_API_KEY = KEY; // mint は write 専用キーを要求（P2-b）
  process.env.WHALE_EXTERNAL_OA_IDS = "oa1";
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
  mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
});

describe("mint API", () => {
  const ok = () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: "1111-liff" });
    mp.liveSession.findFirst.mockResolvedValue({ startsAt: new Date("2026-08-20T09:00:00Z") });
    mp.liveTicketLinkToken.create.mockResolvedValue({ id: "tok1" });
  };
  it("正常発行: LIFF URL + tokenRecordId を返し、DB へは hash のみ保存", async () => {
    ok();
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100", ticketId: "BEL-123456" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.url).toMatch(/^https:\/\/liff\.line\.me\/1111-liff\/ticket\?t=[A-Za-z0-9_-]+$/);
    expect(json.data.tokenRecordId).toBe("tok1");
    // 旧・有効トークンを失効 → 新規発行
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalled();
    const created = mp.liveTicketLinkToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // 平文トークンは DB data に含めない（url にだけ載る）
    const plaintext = json.data.url.split("t=")[1];
    expect(JSON.stringify(created)).not.toContain(plaintext);
  });
  it("APIキーなしは 401", async () => {
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100" }, {}));
    expect(res.status).toBe(401);
  });
  it("不正 APIキーは 401", async () => {
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100" }, { "x-whale-api-key": "wrong" }));
    expect(res.status).toBe(401);
  });
  it("allowlist 外 OA は 404（存在秘匿）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100" }));
    expect(res.status).toBe(404);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
  it("作品が存在しないは 404", async () => {
    mp.work.findUnique.mockResolvedValue(null);
    const res = await mintPost(mintReq({ workId: "wX", reservationNumber: "R-100" }));
    expect(res.status).toBe(404);
  });
  it("入力不備（reservationNumber なし）は 400", async () => {
    const res = await mintPost(mintReq({ workId: "w1" }));
    expect(res.status).toBe(400);
  });
  it("LIFF 未設定は 422", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: null });
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100" }));
    expect(res.status).toBe(422);
  });
  it("write キー未設定は 503（fail-closed・read キーへフォールバックしない）", async () => {
    ok();
    delete process.env.WHALE_EXTERNAL_WRITE_API_KEY;
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100" }));
    expect(res.status).toBe(503);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
  it("read キーで write API は叩けない（write キーと不一致 → 401）", async () => {
    ok();
    process.env.WHALE_EXTERNAL_WRITE_API_KEY = "different-write-key";
    const res = await mintPost(mintReq({ workId: "w1", reservationNumber: "R-100" }, { "x-whale-api-key": KEY }));
    expect(res.status).toBe(401);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
});

describe("resolve API", () => {
  const baseToken = {
    id: "tk1", oaId: "oa1", workId: "w1", reservationNumber: "R-100", ticketId: "BEL-123456",
    expiresAt: new Date(Date.now() + 86400000), revokedAt: null, firstOpenedAt: null,
  };
  const setActive = () => {
    mp.liveSession.findMany.mockResolvedValue([{ id: "s1", name: "公演A", startsAt: new Date("2026-08-20T09:00:00Z") }]);
    mp.liveTeam.findMany.mockResolvedValue([{ id: "t1", reservationNumber: "R-100", ticketId: "BEL-123456", liveSessionId: "s1", reservedAt: null, groupType: "four" }]);
    mp.work.findUnique.mockResolvedValue({ title: "作品X" });
    mp.oa.findUnique.mockResolvedValue({ liffId: "oa-liff" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 1 });
  };

  it("有効 token で最小情報を返す（個人情報・生ID を含めない）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(baseToken);
    setActive();
    const res = await resolvePost(resolveReq({ token: "x".repeat(43) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.ticket).toMatchObject({ maskedTicketId: "BEL-****56", workTitle: "作品X", groupType: "four", status: "available" });
    expect(json.data.liffId).toBe("oa-liff"); // SDK init 用の公開 liffId を返す
    const body = JSON.stringify(json);
    expect(body).not.toContain("R-100");        // reservationNumber を返さない
    expect(body).not.toContain("BEL-123456");   // 生 ticketId を返さない
    expect(body).not.toContain("tokenHash");
    // firstOpenedAt を初回だけ更新（where firstOpenedAt:null）
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tk1", firstOpenedAt: null } }));
    // participant / eventLog を作らない（mock 未定義 = 呼べば throw）
  });
  it("token なしは TOKEN_NOT_FOUND(404)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(null);
    const res = await resolvePost(resolveReq({ token: "y".repeat(43) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TOKEN_NOT_FOUND");
  });
  it("期限切れは TOKEN_EXPIRED(410)・参加者を推測しない", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...baseToken, expiresAt: new Date(Date.now() - 1000) });
    const res = await resolvePost(resolveReq({ token: "z".repeat(43) }));
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("TOKEN_EXPIRED");
    expect(mp.liveSession.findMany).not.toHaveBeenCalled();
  });
  it("失効は TOKEN_REVOKED(410)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...baseToken, revokedAt: new Date() });
    const res = await resolvePost(resolveReq({ token: "z".repeat(43) }));
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("TOKEN_REVOKED");
  });
  it("active セッションが無ければ WORK_NOT_ACTIVE(409)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(baseToken);
    mp.liveSession.findMany.mockResolvedValue([]);
    const res = await resolvePost(resolveReq({ token: "z".repeat(43) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("WORK_NOT_ACTIVE");
  });
  it("どのチームにも一致しなければ TICKET_NOT_FOUND(404)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(baseToken);
    setActive();
    mp.liveTeam.findMany.mockResolvedValue([{ id: "tX", reservationNumber: "R-999", ticketId: "OTHER", liveSessionId: "s1", reservedAt: null, groupType: "two" }]);
    const res = await resolvePost(resolveReq({ token: "z".repeat(43) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TICKET_NOT_FOUND");
  });
  it("複数チームが同一予約番号で曖昧なら TICKET_NOT_FOUND(404)（先頭を勝手に採用しない）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...baseToken, ticketId: null });
    setActive();
    mp.liveTeam.findMany.mockResolvedValue([
      { id: "t1", reservationNumber: "R-100", ticketId: null, liveSessionId: "s1", reservedAt: null, groupType: "two" },
      { id: "t2", reservationNumber: "R-100", ticketId: null, liveSessionId: "s1", reservedAt: null, groupType: "two" },
    ]);
    const res = await resolvePost(resolveReq({ token: "z".repeat(43) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TICKET_NOT_FOUND");
  });
});
