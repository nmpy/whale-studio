// src/__tests__/live-ticket-link-api.test.ts
// 匿名連携 mint API（POST /api/external/v1/live/ticket-links）と resolve API（/api/liff/tickets/resolve）のテスト。
// prisma は mock。external-auth は env でキー/allowlist を設定して実物を使う。
//
// 契約変更（新設計・匿名連携）: POST は reservationNumber/ticketId を受け取らず、
// workId + externalSessionRef + externalBookingRef + capacity(2/4) のみ。個人情報フィールドは strict で 400。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp } = vi.hoisted(() => ({
  mp: {
    work: { findUnique: vi.fn() },
    oa: { findUnique: vi.fn() },
    liveSession: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    liveTeam: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    liveTicketLinkToken: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
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
const validBody = { workId: "w1", externalSessionRef: "uzu-session-1", externalBookingRef: "uzu-booking-1", capacity: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHALE_EXTERNAL_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_WRITE_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = "oa1";
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
  mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
});

describe("匿名 mint API（POST ticket-links）", () => {
  const ok = () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: "1111-liff" });
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-session-1", status: "draft", startsAt: new Date("2026-08-20T09:00:00Z"), endsAt: null });
    mp.liveTeam.upsert.mockResolvedValue({ id: "team1" });
    mp.liveTicketLinkToken.create.mockResolvedValue({ id: "tok1" });
  };

  it("9,18: 匿名 team を upsert し LIFF URL + tokenRecordId を返す（t= クエリ）", async () => {
    ok();
    const res = await mintPost(mintReq(validBody));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.url).toMatch(/^https:\/\/liff\.line\.me\/1111-liff\/ticket\?t=[A-Za-z0-9_-]+$/);
    expect(json.data.tokenRecordId).toBe("tok1");
    expect(mp.liveTeam.upsert).toHaveBeenCalledTimes(1);
    // 冪等 upsert キー（同一 session + booking ref は重複作成しない）
    expect(mp.liveTeam.upsert.mock.calls[0][0].where).toEqual({ liveSessionId_externalBookingRef: { liveSessionId: "s1", externalBookingRef: "uzu-booking-1" } });
    expect(mp.liveTeam.create).not.toHaveBeenCalled();
  });

  it("10: team に氏名/メール/ticketId/予約番号を保存しない（匿名のみ）", async () => {
    ok();
    await mintPost(mintReq(validBody));
    const created = mp.liveTeam.upsert.mock.calls[0][0].create;
    expect(created.externalBookingRef).toBe("uzu-booking-1");
    expect(created.capacity).toBe(4);
    expect("purchaserName" in created).toBe(false);
    expect("ticketId" in created).toBe(false);
    expect("reservationNumber" in created).toBe(false);
    expect(JSON.stringify(created)).not.toMatch(/@|山田|purchaser/i);
  });

  it("11,12: capacity 2 / 4 を保存できる（groupType 互換も設定）", async () => {
    ok();
    await mintPost(mintReq({ ...validBody, capacity: 2 }));
    expect(mp.liveTeam.upsert.mock.calls[0][0].create).toMatchObject({ capacity: 2, groupType: "two" });
    vi.clearAllMocks(); ok(); mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp)); mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
    await mintPost(mintReq({ ...validBody, capacity: 4 }));
    expect(mp.liveTeam.upsert.mock.calls[0][0].create).toMatchObject({ capacity: 4, groupType: "four" });
  });

  it("13: capacity 1/3/5 は 400（team/token を作らない）", async () => {
    ok();
    for (const c of [1, 3, 5, 0, 100]) {
      vi.clearAllMocks(); ok(); mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
      const res = await mintPost(mintReq({ ...validBody, capacity: c }));
      expect(res.status).toBe(400);
      expect(mp.liveTeam.upsert).not.toHaveBeenCalled();
      expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
    }
  });

  it("PII/未知フィールドを含む body は 400（strict）", async () => {
    ok();
    for (const extra of [{ purchaserName: "山田" }, { email: "a@example.com" }, { ticketId: "BEL-1" }, { reservationNumber: "R-1" }, { purchasedAt: "2026-01-01" }, { ticketType: "2名" }, { phone: "090" }]) {
      vi.clearAllMocks(); ok(); mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
      const res = await mintPost(mintReq({ ...validBody, ...extra }));
      expect(res.status).toBe(400);
      expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
    }
  });

  it("15,16,17: 再発行は旧・有効トークンを失効してから新規発行・平文は DB に載らない", async () => {
    ok();
    const res = await mintPost(mintReq(validBody));
    const json = await res.json();
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalled(); // 旧トークン revoke
    expect(mp.liveTicketLinkToken.create).toHaveBeenCalledTimes(1); // 新規 1 件
    const created = mp.liveTicketLinkToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.reservationNumber).toBe("uzu-booking-1"); // schema 互換マップ
    const plaintext = json.data.url.split("t=")[1];
    expect(JSON.stringify(created)).not.toContain(plaintext); // 平文トークン非保存
  });

  it("19: session 未同期は 409（明示エラー・発行しない）", async () => {
    ok();
    mp.liveSession.findFirst.mockResolvedValue(null);
    const res = await mintPost(mintReq(validBody));
    expect(res.status).toBe(409);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });

  it("20: allowlist 外 OA の作品は 404（存在秘匿・発行しない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    const res = await mintPost(mintReq(validBody));
    expect(res.status).toBe(404);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });

  it("作品が存在しないは 404", async () => {
    mp.work.findUnique.mockResolvedValue(null);
    expect((await mintPost(mintReq(validBody))).status).toBe(404);
  });
  it("LIFF 未設定は 422", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: null });
    expect((await mintPost(mintReq(validBody))).status).toBe(422);
  });
  it("APIキーなし/不正は 401", async () => {
    expect((await mintPost(mintReq(validBody, {}))).status).toBe(401);
    expect((await mintPost(mintReq(validBody, { "x-whale-api-key": "wrong" }))).status).toBe(401);
  });
  it("write キー未設定は 503（read キーへフォールバックしない）", async () => {
    ok();
    delete process.env.WHALE_EXTERNAL_WRITE_API_KEY;
    const res = await mintPost(mintReq(validBody));
    expect(res.status).toBe(503);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
  it("read キーで write API は叩けない（401）", async () => {
    ok();
    process.env.WHALE_EXTERNAL_WRITE_API_KEY = "different-write-key";
    const res = await mintPost(mintReq(validBody, { "x-whale-api-key": KEY }));
    expect(res.status).toBe(401);
  });
});

describe("resolve API（新設計 直接解決 + legacy fallback）", () => {
  const directToken = {
    id: "tk1", oaId: "oa1", workId: "w1", reservationNumber: "uzu-booking-1", ticketId: null,
    liveSessionId: "s1", teamId: "team1",
    expiresAt: new Date(Date.now() + 86400000), revokedAt: null, firstOpenedAt: null,
  };
  const legacyToken = {
    id: "tk2", oaId: "oa1", workId: "w1", reservationNumber: "R-100", ticketId: "BEL-123456",
    liveSessionId: null, teamId: null,
    expiresAt: new Date(Date.now() + 86400000), revokedAt: null, firstOpenedAt: null,
  };
  const commonDisplay = () => {
    mp.work.findUnique.mockResolvedValue({ title: "作品X" });
    mp.oa.findUnique.mockResolvedValue({ liffId: "oa-liff" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 1 });
  };

  it("21: 新設計トークンは token.teamId/liveSessionId から直接解決（active セッション検索を使わない）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "s1", reservedAt: null, groupType: "four" });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oa1", workId: "w1", name: "公演A", startsAt: new Date("2026-08-20T09:00:00Z") });
    commonDisplay();
    const res = await resolvePost(resolveReq({ token: "x".repeat(43) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.ticket).toMatchObject({ workTitle: "作品X", groupType: "four", status: "available" });
    expect(mp.liveSession.findMany).not.toHaveBeenCalled(); // legacy 経路は使わない
  });

  it("22: 匿名 team は reservationNumber=null でも直接解決できる", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "s1", reservedAt: null, groupType: null });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oa1", workId: "w1", name: "公演A", startsAt: null });
    commonDisplay();
    const res = await resolvePost(resolveReq({ token: "x".repeat(43) }));
    expect(res.status).toBe(200);
  });

  it("23: team と session の組み合わせが不整合なら TICKET_NOT_FOUND(404)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "sZ", reservedAt: null, groupType: "four" }); // 別 session
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oa1", workId: "w1", name: "公演A", startsAt: null });
    const res = await resolvePost(resolveReq({ token: "x".repeat(43) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TICKET_NOT_FOUND");
  });

  it("23b: session.oaId が token.oaId と異なれば拒否（テナント越境防止）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "s1", reservedAt: null, groupType: "four" });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oaOTHER", workId: "w1", name: "公演A", startsAt: null });
    expect((await resolvePost(resolveReq({ token: "x".repeat(43) }))).status).toBe(404);
  });

  it("24,25: revoked/expired は 410", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...directToken, revokedAt: new Date() });
    expect((await resolvePost(resolveReq({ token: "x".repeat(43) }))).status).toBe(410);
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...directToken, expiresAt: new Date(Date.now() - 1000) });
    const r = await resolvePost(resolveReq({ token: "x".repeat(43) }));
    expect(r.status).toBe(410);
    expect(mp.liveTeam.findUnique).not.toHaveBeenCalled(); // 期限切れは解決に進まない
  });

  it("26: legacy トークン（liveSessionId/teamId なし）は reservationNumber フォールバックで解決", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(legacyToken);
    mp.liveSession.findMany.mockResolvedValue([{ id: "s1", name: "公演A", startsAt: new Date("2026-08-20T09:00:00Z") }]);
    mp.liveTeam.findMany.mockResolvedValue([{ id: "t1", reservationNumber: "R-100", ticketId: "BEL-123456", liveSessionId: "s1", reservedAt: null, groupType: "four" }]);
    commonDisplay();
    const res = await resolvePost(resolveReq({ token: "y".repeat(43) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.ticket.maskedTicketId).toBe("BEL-****56");
    const body = JSON.stringify(json);
    expect(body).not.toContain("R-100");
    expect(body).not.toContain("BEL-123456");
  });

  it("27: legacy の ambiguous 挙動は維持（先頭を勝手に採用しない → TICKET_NOT_FOUND）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...legacyToken, ticketId: null });
    mp.liveSession.findMany.mockResolvedValue([{ id: "s1", name: "公演A", startsAt: null }]);
    mp.liveTeam.findMany.mockResolvedValue([
      { id: "t1", reservationNumber: "R-100", ticketId: null, liveSessionId: "s1", reservedAt: null, groupType: "two" },
      { id: "t2", reservationNumber: "R-100", ticketId: null, liveSessionId: "s1", reservedAt: null, groupType: "two" },
    ]);
    const res = await resolvePost(resolveReq({ token: "y".repeat(43) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TICKET_NOT_FOUND");
  });

  it("legacy: active セッションが無ければ WORK_NOT_ACTIVE(409)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(legacyToken);
    mp.liveSession.findMany.mockResolvedValue([]);
    const res = await resolvePost(resolveReq({ token: "y".repeat(43) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("WORK_NOT_ACTIVE");
  });

  it("token なしは TOKEN_NOT_FOUND(404)", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(null);
    expect((await resolvePost(resolveReq({ token: "z".repeat(43) }))).status).toBe(404);
  });
});
