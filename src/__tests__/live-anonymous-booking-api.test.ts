// src/__tests__/live-anonymous-booking-api.test.ts
// 匿名連携（ウズプロCMS → Whale Studio）の外部 API テスト:
//   PUT  /api/external/v1/live/sessions        … 公演セッション冪等 upsert（1-8）
//   GET  /api/external/v1/live/ticket-links     … チケットリンク状態取得（28-31）
//   POST /api/external/v1/live/ticket-links/revoke … 失効（32-34）
// prisma は mock。external-auth は env でキー/allowlist を設定して実物を使う。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mp } = vi.hoisted(() => ({
  mp: {
    work: { findUnique: vi.fn() },
    liveSession: { upsert: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    liveTeam: { findFirst: vi.fn(), delete: vi.fn() },
    liveTicketLinkToken: { findFirst: vi.fn(), updateMany: vi.fn() },
    liveParticipant: { count: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { PUT as sessionsPut } from "@/app/api/external/v1/live/sessions/route";
import { GET as linkGet, POST as linkPost } from "@/app/api/external/v1/live/ticket-links/route";
import { POST as revokePost } from "@/app/api/external/v1/live/ticket-links/revoke/route";

const KEY = "test-external-key";
const H = { "x-whale-api-key": KEY, "Content-Type": "application/json" };

function putReq(body: unknown, headers: Record<string, string> = H) {
  return new NextRequest("http://localhost/api/external/v1/live/sessions", { method: "PUT", headers, body: JSON.stringify(body) });
}
function getReq(qs: Record<string, string>, headers: Record<string, string> = H) {
  const u = new URL("http://localhost/api/external/v1/live/ticket-links");
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  return new NextRequest(u, { method: "GET", headers });
}
function revokeReq(body: unknown, headers: Record<string, string> = H) {
  return new NextRequest("http://localhost/api/external/v1/live/ticket-links/revoke", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHALE_EXTERNAL_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_WRITE_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = "oa1";
});

// ───────────────────────── Session 同期（PUT）1-8 ─────────────────────────
describe("PUT /live/sessions（公演セッション冪等 upsert）", () => {
  const okWork = () => mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
  const body = { workId: "w1", externalSessionRef: "uzu-s-1", startsAt: "2026-08-17T18:00:00+09:00", endsAt: "2026-08-17T21:00:00+09:00" };

  it("1: 新しい externalSessionRef で LiveSession を draft 作成できる", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", startsAt: new Date("2026-08-17T09:00:00Z"), endsAt: new Date("2026-08-17T12:00:00Z") });
    const res = await sessionsPut(putReq(body));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.session).toMatchObject({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft" });
    expect(mp.liveSession.upsert.mock.calls[0][0].create).toMatchObject({ status: "draft", oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1" });
  });

  it("2: 冪等 upsert キー（oaId+workId+externalSessionRef）で重複を作らない", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", startsAt: null, endsAt: null });
    await sessionsPut(putReq(body));
    expect(mp.liveSession.upsert.mock.calls[0][0].where).toEqual({ oaId_workId_externalSessionRef: { oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1" } });
    expect(mp.liveSession.create).not.toHaveBeenCalled();
  });

  it("3: 再送は日時のみ更新し status を変更しない（active→draft 降格 / ended 再オープンを防ぐ）", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "active", startsAt: null, endsAt: null });
    await sessionsPut(putReq(body));
    const update = mp.liveSession.upsert.mock.calls[0][0].update;
    expect("status" in update).toBe(false); // update で status を触らない
    expect(update).toHaveProperty("startsAt");
    expect(update).toHaveProperty("endsAt");
  });

  it("4: 別 OA に同じ externalSessionRef があっても where に oaId を含み干渉しない", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", startsAt: null, endsAt: null });
    await sessionsPut(putReq(body));
    expect(mp.liveSession.upsert.mock.calls[0][0].where.oaId_workId_externalSessionRef.oaId).toBe("oa1");
  });

  it("5: allowlist 外 OA は 404（upsert しない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    const res = await sessionsPut(putReq(body));
    expect(res.status).toBe(404);
    expect(mp.liveSession.upsert).not.toHaveBeenCalled();
  });
  it("6: 存在しない work は 404", async () => {
    mp.work.findUnique.mockResolvedValue(null);
    expect((await sessionsPut(putReq(body))).status).toBe(404);
  });
  it("7: 別 OA の work は 404（allowlist 外 oaId）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaOTHER" });
    expect((await sessionsPut(putReq(body))).status).toBe(404);
  });
  it("8: 未知 PII フィールドを含む body は 400（strict・upsert しない）", async () => {
    okWork();
    for (const extra of [{ purchaserName: "山田太郎" }, { email: "a@example.com" }, { ticketId: "BEL-1" }, { phone: "090" }]) {
      vi.clearAllMocks(); okWork();
      const res = await sessionsPut(putReq({ ...body, ...extra }));
      expect(res.status).toBe(400);
      expect(mp.liveSession.upsert).not.toHaveBeenCalled();
    }
  });
  it("認証なしは 401", async () => {
    expect((await sessionsPut(putReq(body, { "Content-Type": "application/json" }))).status).toBe(401);
  });
});

// ───────────────────────── 状態取得（GET）28-31 ─────────────────────────
describe("GET /live/ticket-links（状態取得）", () => {
  const setup = () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", startsAt: null, endsAt: null });
    mp.liveTeam.findFirst.mockResolvedValue({ id: "team1", capacity: 4 });
    mp.liveParticipant.count.mockResolvedValue(0);
  };
  const qs = { workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" };

  it("28a: 有効トークンあり → state=active + capacity + sessionStatus", async () => {
    setup();
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 86400000) }); // active query
    const res = await linkGet(getReq(qs));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.link).toMatchObject({ state: "active", capacity: 4, sessionStatus: "draft", registrationCount: 0 });
    expect(json.data.link.expiresAt).toBeTruthy();
  });
  it("28b: 有効なし・最新が revoked → state=revoked", async () => {
    setup();
    mp.liveTicketLinkToken.findFirst
      .mockResolvedValueOnce(null) // active query
      .mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 86400000), revokedAt: new Date() }); // latest
    const json = await (await linkGet(getReq(qs))).json();
    expect(json.data.link.state).toBe("revoked");
  });
  it("28c: 有効なし・最新が期限切れ → state=expired", async () => {
    setup();
    mp.liveTicketLinkToken.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1000), revokedAt: null });
    const json = await (await linkGet(getReq(qs))).json();
    expect(json.data.link.state).toBe("expired");
  });
  it("29: registrationCount を対象 team の participant 数から返す", async () => {
    setup();
    mp.liveParticipant.count.mockResolvedValue(2);
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 86400000) });
    const json = await (await linkGet(getReq(qs))).json();
    expect(json.data.link.registrationCount).toBe(2);
    expect(mp.liveParticipant.count).toHaveBeenCalledWith({ where: { teamId: "team1" } });
  });
  it("30,31: tokenHash / 平文トークン / LINE UID / 個人情報 を返さない", async () => {
    setup();
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 86400000) });
    const body = JSON.stringify(await (await linkGet(getReq(qs))).json());
    for (const s of ["tokenHash", "token_hash", "lineUserId", "line_user_id", "purchaserName", "reservationNumber"]) {
      expect(body).not.toContain(s);
    }
  });
  it("GET は read キー認証・別 OA work は 404", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    expect((await linkGet(getReq(qs))).status).toBe(404);
  });
  it("session 未同期は 404", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveSession.findFirst.mockResolvedValue(null);
    expect((await linkGet(getReq(qs))).status).toBe(404);
  });
});

// ───────────────────────── 失効（POST revoke）32-34 ─────────────────────────
describe("POST /live/ticket-links/revoke", () => {
  const body = { workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" };

  it("32: 複数回実行してもエラーにならない（冪等）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await revokePost(revokeReq(body))).status).toBe(200);
    const second = await revokePost(revokeReq(body));
    expect(second.status).toBe(200);
    expect((await second.json()).data.revoked).toBe(0);
  });

  it("33: 別 OA からは失効できない（404・updateMany を呼ばない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    const res = await revokePost(revokeReq(body));
    expect(res.status).toBe(404);
    expect(mp.liveTicketLinkToken.updateMany).not.toHaveBeenCalled();
  });

  it("34: LiveTeam/LiveSession/LiveParticipant を削除しない（revokedAt 更新のみ・oaId 境界）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 2 });
    await revokePost(revokeReq(body));
    const call = mp.liveTicketLinkToken.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ revokedAt: expect.any(Date) });
    expect(call.where).toMatchObject({ oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1", revokedAt: null });
    expect(mp.liveTeam.delete).not.toHaveBeenCalled();
  });
  it("未知フィールドは 400（strict）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    expect((await revokePost(revokeReq({ ...body, email: "a@example.com" }))).status).toBe(400);
  });
  it("認証なしは 401", async () => {
    expect((await revokePost(revokeReq(body, { "Content-Type": "application/json" }))).status).toBe(401);
  });
});
