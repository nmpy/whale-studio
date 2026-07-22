// src/__tests__/live-anonymous-booking-api.test.ts
// v2 匿名連携（ウズプロCMS → Whale Studio）の外部 API + パス分離 + resolve 直接解決テスト:
//   PUT  /api/external/v2/live/sessions        … 公演セッション冪等 upsert
//   POST /api/external/v2/live/ticket-links     … 匿名発行（PII 拒否・capacity 2/4）
//   GET  /api/external/v2/live/ticket-links     … 状態取得（PII 非返却）
//   POST /api/external/v2/live/ticket-links/revoke … 冪等失効
//   /api/liff/tickets/resolve                   … v2 発行トークンの直接解決（liveSessionId/teamId 優先）
// prisma は mock。external-auth は env でキー/allowlist を設定して実物を使う。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const { mp } = vi.hoisted(() => ({
  mp: {
    work: { findUnique: vi.fn() },
    oa: { findUnique: vi.fn() },
    liveSession: { upsert: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    liveTeam: { upsert: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    liveTicketLinkToken: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    liveParticipant: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { PUT as sessionsPut } from "@/app/api/external/v2/live/sessions/route";
import { POST as linkPost, GET as linkGet } from "@/app/api/external/v2/live/ticket-links/route";
import { POST as revokePost } from "@/app/api/external/v2/live/ticket-links/revoke/route";
import * as v1TicketLinks from "@/app/api/external/v1/live/ticket-links/route";
import { POST as resolvePost } from "@/app/api/liff/tickets/resolve/route";

const KEY = "test-external-key";
const H = { "x-whale-api-key": KEY, "Content-Type": "application/json" };
const putReq = (body: unknown, headers: Record<string, string> = H) =>
  new NextRequest("http://localhost/api/external/v2/live/sessions", { method: "PUT", headers, body: JSON.stringify(body) });
const postReq = (body: unknown, headers: Record<string, string> = H) =>
  new NextRequest("http://localhost/api/external/v2/live/ticket-links", { method: "POST", headers, body: JSON.stringify(body) });
function getReq(qs: Record<string, string>, headers: Record<string, string> = H) {
  const u = new URL("http://localhost/api/external/v2/live/ticket-links");
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  return new NextRequest(u, { method: "GET", headers });
}
const revokeReq = (body: unknown, headers: Record<string, string> = H) =>
  new NextRequest("http://localhost/api/external/v2/live/ticket-links/revoke", { method: "POST", headers, body: JSON.stringify(body) });
const resolveReq = (body: unknown) =>
  new NextRequest("http://localhost/api/liff/tickets/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHALE_EXTERNAL_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_WRITE_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = "oa1";
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
  mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
});

// ───────── v2 PUT /live/sessions（冪等 upsert）─────────
describe("v2 PUT /live/sessions", () => {
  const okWork = () => mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
  const body = { workId: "w1", externalSessionRef: "uzu-s-1", startsAt: "2026-08-17T18:00:00+09:00", endsAt: "2026-08-17T21:00:00+09:00" };

  it("10: 新しい externalSessionRef で draft 作成（冪等 upsert キー）", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    const json = await (await sessionsPut(putReq(body))).json();
    // 外部契約: 内部主キー（id）は返さない。externalSessionRef / status のみ。
    expect(json.data.session).toMatchObject({ externalSessionRef: "uzu-s-1", status: "draft" });
    expect("id" in json.data.session).toBe(false);
    expect(mp.liveSession.upsert.mock.calls[0][0].where).toEqual({ oaId_workId_externalSessionRef: { oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1" } });
    expect(mp.liveSession.create).not.toHaveBeenCalled();
  });
  it("再送は日時のみ更新し status を変更しない（active→draft/ended 再オープン防止）", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "active", origin: "UZU_PRO", startsAt: null, endsAt: null });
    await sessionsPut(putReq(body));
    const update = mp.liveSession.upsert.mock.calls[0][0].update;
    expect("status" in update).toBe(false);
    expect(update).toHaveProperty("startsAt");
  });
  it("別 OA の externalSessionRef と干渉しない（where に oaId）", async () => {
    okWork();
    mp.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    await sessionsPut(putReq(body));
    expect(mp.liveSession.upsert.mock.calls[0][0].where.oaId_workId_externalSessionRef.oaId).toBe("oa1");
  });
  it("allowlist 外/不在/別 OA の work は 404（upsert しない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    expect((await sessionsPut(putReq(body))).status).toBe(404);
    mp.work.findUnique.mockResolvedValue(null);
    expect((await sessionsPut(putReq(body))).status).toBe(404);
    expect(mp.liveSession.upsert).not.toHaveBeenCalled();
  });
  it("未知 PII フィールドは 400（strict・upsert しない）", async () => {
    for (const extra of [{ purchaserName: "山田" }, { email: "a@example.com" }, { ticketId: "BEL-1" }, { reservationNumber: "R-1" }]) {
      vi.clearAllMocks(); okWork();
      expect((await sessionsPut(putReq({ ...body, ...extra }))).status).toBe(400);
      expect(mp.liveSession.upsert).not.toHaveBeenCalled();
    }
  });
  it("認証なしは 401", async () => {
    expect((await sessionsPut(putReq(body, { "Content-Type": "application/json" }))).status).toBe(401);
  });
});

// ───────── v2 POST /live/ticket-links（匿名発行）─────────
describe("v2 POST /live/ticket-links", () => {
  const validBody = { workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1", capacity: 4 };
  const ok = () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: "1111-liff" });
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: new Date("2026-08-20T09:00:00Z"), endsAt: null });
    mp.liveTeam.upsert.mockResolvedValue({ id: "team1", origin: "UZU_PRO" });
    mp.liveTicketLinkToken.create.mockResolvedValue({ id: "tok1" });
  };

  it("11,23: 匿名 team/token を作成し LIFF URL を返す（t= クエリ・冪等 upsert キー）", async () => {
    ok();
    const json = await (await linkPost(postReq(validBody))).json();
    expect(json.data.url).toMatch(/^https:\/\/liff\.line\.me\/1111-liff\/ticket\?t=[A-Za-z0-9_-]+$/);
    // 外部契約: 内部主キー（tokenRecordId）は返さない。匿名 ref と URL / expiresAt のみ。
    expect(json.data).toMatchObject({ externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" });
    expect(typeof json.data.expiresAt).toBe("string");
    expect("tokenRecordId" in json.data).toBe(false);
    expect(mp.liveTeam.upsert.mock.calls[0][0].where).toEqual({ liveSessionId_externalBookingRef: { liveSessionId: "s1", externalBookingRef: "uzu-b-1" } });
    expect(mp.liveTeam.create).not.toHaveBeenCalled();
  });
  it("team に氏名/メール/ticketId/予約番号を保存しない（匿名のみ）", async () => {
    ok();
    await linkPost(postReq(validBody));
    const created = mp.liveTeam.upsert.mock.calls[0][0].create;
    expect(created).toMatchObject({ externalBookingRef: "uzu-b-1", capacity: 4 });
    expect("purchaserName" in created).toBe(false);
    expect("ticketId" in created).toBe(false);
    expect("reservationNumber" in created).toBe(false);
  });
  it("17: capacity 2/4 を許可し groupType 互換を設定", async () => {
    ok();
    await linkPost(postReq({ ...validBody, capacity: 2 }));
    expect(mp.liveTeam.upsert.mock.calls[0][0].create).toMatchObject({ capacity: 2, groupType: "two" });
  });
  it("17b: capacity 1/3/5 は 400（作成しない）", async () => {
    for (const c of [1, 3, 5, 0]) {
      vi.clearAllMocks(); ok(); mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
      expect((await linkPost(postReq({ ...validBody, capacity: c }))).status).toBe(400);
      expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
    }
  });
  it("14,15,16: reservationNumber/ticketId/氏名/メール等 PII は 400（strict）", async () => {
    for (const extra of [{ reservationNumber: "R-1" }, { ticketId: "BEL-1" }, { purchaserName: "山田" }, { name: "x" }, { email: "a@example.com" }, { purchasedAt: "2026-01-01" }, { ticketType: "2名" }, { phone: "090" }, { address: "東京" }]) {
      vi.clearAllMocks(); ok(); mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
      expect((await linkPost(postReq({ ...validBody, ...extra }))).status).toBe(400);
      expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
    }
  });
  it("再発行は旧・有効トークンを失効してから新規発行・平文は DB に載らない", async () => {
    ok();
    const json = await (await linkPost(postReq(validBody))).json();
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalled();
    const created = mp.liveTicketLinkToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.reservationNumber).toBe("uzu-b-1"); // schema 互換マップ（外部契約では非公開）
    expect(JSON.stringify(created)).not.toContain(json.data.url.split("t=")[1]);
  });
  it("session 未同期は 409（発行しない）", async () => {
    ok();
    mp.liveSession.findFirst.mockResolvedValue(null);
    expect((await linkPost(postReq(validBody))).status).toBe(409);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
  it("18: 別 OA の作品は 404（発行しない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    expect((await linkPost(postReq(validBody))).status).toBe(404);
    expect(mp.liveTicketLinkToken.create).not.toHaveBeenCalled();
  });
  it("LIFF 未設定は 422 / 認証なしは 401", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: null });
    expect((await linkPost(postReq(validBody))).status).toBe(422);
    expect((await linkPost(postReq(validBody, { "Content-Type": "application/json" }))).status).toBe(401);
  });
});

// ───────── v2 GET /live/ticket-links（状態取得）─────────
describe("v2 GET /live/ticket-links", () => {
  const qs = { workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" };
  const setup = () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    mp.liveTeam.findFirst.mockResolvedValue({ id: "team1", capacity: 4 });
    mp.liveParticipant.count.mockResolvedValue(0);
  };
  it("12: active/revoked/expired を返す", async () => {
    setup();
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 86400000) });
    expect((await (await linkGet(getReq(qs))).json()).data.link).toMatchObject({ state: "active", capacity: 4, sessionStatus: "draft" });
    setup();
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 8.64e7), revokedAt: new Date() });
    expect((await (await linkGet(getReq(qs))).json()).data.link.state).toBe("revoked");
    setup();
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1000), revokedAt: null });
    expect((await (await linkGet(getReq(qs))).json()).data.link.state).toBe("expired");
  });
  it("registrationCount を team の participant 数から返す", async () => {
    setup();
    mp.liveParticipant.count.mockResolvedValue(2);
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 8.64e7) });
    const json = await (await linkGet(getReq(qs))).json();
    expect(json.data.link.registrationCount).toBe(2);
    expect(mp.liveParticipant.count).toHaveBeenCalledWith({ where: { teamId: "team1", origin: "UZU_PRO" } });
  });
  it("19: tokenHash/平文/LINE UID/PII を返さない", async () => {
    setup();
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 8.64e7) });
    const body = JSON.stringify(await (await linkGet(getReq(qs))).json());
    for (const s of ["tokenHash", "token_hash", "lineUserId", "line_user_id", "purchaserName", "reservationNumber"]) expect(body).not.toContain(s);
  });
  it("18: 別 OA work は 404 / session 未同期は 404", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    expect((await linkGet(getReq(qs))).status).toBe(404);
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveSession.findFirst.mockResolvedValue(null);
    expect((await linkGet(getReq(qs))).status).toBe(404);
  });
});

// ───────── v2 POST /live/ticket-links/revoke ─────────
describe("v2 POST /live/ticket-links/revoke", () => {
  const body = { workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" };
  it("13: 複数回実行してもエラーにならない（冪等）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await revokePost(revokeReq(body))).status).toBe(200);
    const second = await revokePost(revokeReq(body));
    expect((await second.json()).data.revoked).toBe(0);
  });
  it("18: 別 OA からは失効できない（404・updateMany 呼ばない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    expect((await revokePost(revokeReq(body))).status).toBe(404);
    expect(mp.liveTicketLinkToken.updateMany).not.toHaveBeenCalled();
  });
  it("Team/Session/Participant を削除しない（revokedAt 更新のみ・oaId 境界）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 2 });
    await revokePost(revokeReq(body));
    const call = mp.liveTicketLinkToken.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ revokedAt: expect.any(Date) });
    expect(call.where).toMatchObject({ oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1", revokedAt: null });
    expect(mp.liveTeam.delete).not.toHaveBeenCalled();
  });
  it("未知フィールドは 400 / 認証なしは 401", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    expect((await revokePost(revokeReq({ ...body, email: "a@example.com" }))).status).toBe(400);
    expect((await revokePost(revokeReq(body, { "Content-Type": "application/json" }))).status).toBe(401);
  });
});

// ───────── resolve: v2 発行トークンの直接解決（26,27）─────────
describe("resolve（v2 anonymous token 直接解決）", () => {
  const directToken = {
    id: "tk1", oaId: "oa1", workId: "w1", reservationNumber: "uzu-b-1", ticketId: null,
    liveSessionId: "s1", teamId: "team1", expiresAt: new Date(Date.now() + 8.64e7), revokedAt: null, firstOpenedAt: null,
  };
  const display = () => {
    mp.work.findUnique.mockResolvedValue({ title: "作品X" });
    mp.oa.findUnique.mockResolvedValue({ liffId: "oa-liff" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 1 });
  };
  it("26: teamId/liveSessionId から直接解決（active 検索を使わない）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "s1", reservedAt: null, groupType: "four" });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oa1", workId: "w1", name: "公演A", startsAt: null });
    display();
    const res = await resolvePost(resolveReq({ token: "x".repeat(43) }));
    expect(res.status).toBe(200);
    expect(mp.liveSession.findMany).not.toHaveBeenCalled();
  });
  it("27: 匿名 team は reservationNumber=null でも解決できる", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "s1", reservedAt: null, groupType: null });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oa1", workId: "w1", name: "公演A", startsAt: null });
    display();
    expect((await resolvePost(resolveReq({ token: "x".repeat(43) }))).status).toBe(200);
  });
  it("team↔session/oa 不整合は拒否（404）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(directToken);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "sZ", reservedAt: null, groupType: "four" });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oa1", workId: "w1", name: "公演A", startsAt: null });
    expect((await resolvePost(resolveReq({ token: "x".repeat(43) }))).status).toBe(404);
    mp.liveTeam.findUnique.mockResolvedValue({ id: "team1", liveSessionId: "s1", reservedAt: null, groupType: "four" });
    mp.liveSession.findUnique.mockResolvedValue({ id: "s1", oaId: "oaOTHER", workId: "w1", name: "公演A", startsAt: null });
    expect((await resolvePost(resolveReq({ token: "x".repeat(43) }))).status).toBe(404);
  });
  it("revoked/expired は 410（解決に進まない）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue({ ...directToken, revokedAt: new Date() });
    expect((await resolvePost(resolveReq({ token: "x".repeat(43) }))).status).toBe(410);
  });
});

// ───────── origin 分離（external v2 は UZU_PRO のみを扱う）─────────
describe("origin 分離（external v2 = UZU_PRO 境界）", () => {
  // 6: external v2 は NATIVE を get/update/revoke できない（where に origin=UZU_PRO）
  it("6a: GET/POST は session を origin=UZU_PRO で引く（NATIVE は取得できない）", async () => {
    // GET
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    mp.liveTeam.findFirst.mockResolvedValue({ id: "team1", capacity: 4 });
    mp.liveParticipant.count.mockResolvedValue(0);
    mp.liveTicketLinkToken.findFirst.mockResolvedValueOnce({ expiresAt: new Date(Date.now() + 8.64e7) });
    await linkGet(getReq({ workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" }));
    expect(mp.liveSession.findFirst.mock.calls[0][0].where.origin).toBe("UZU_PRO");
    // team gate も origin=UZU_PRO（test 8: UZU_PRO session は NATIVE team を取得できない）
    expect(mp.liveTeam.findFirst.mock.calls[0][0].where.origin).toBe("UZU_PRO");
    // token 状態照会も origin=UZU_PRO
    expect(mp.liveTicketLinkToken.findFirst.mock.calls[0][0].where.origin).toBe("UZU_PRO");
  });
  it("6b: revoke は updateMany where に origin=UZU_PRO（NATIVE token を失効できない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
    await revokePost(revokeReq({ workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" }));
    expect(mp.liveTicketLinkToken.updateMany.mock.calls[0][0].where.origin).toBe("UZU_PRO");
  });

  // 11: external v2 レスポンスは内部主キーを一切含まない（id / tokenRecordId / teamId / liveSessionId）
  it("11a: PUT /sessions レスポンスに内部 ID を含まない", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.liveSession.upsert.mockResolvedValue({ id: "SESSION_INTERNAL_ID", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    const json = await (await sessionsPut(putReq({ workId: "w1", externalSessionRef: "uzu-s-1", startsAt: "2026-08-17T18:00:00+09:00", endsAt: "2026-08-17T21:00:00+09:00" }))).json();
    const body = JSON.stringify(json);
    expect(body).not.toContain("SESSION_INTERNAL_ID");
    for (const k of ["tokenRecordId", "teamId", "liveSessionId"]) expect(body).not.toContain(k);
    expect("id" in json.data.session).toBe(false);
  });
  it("11b: POST /ticket-links レスポンスに内部 ID を含まない", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.oa.findUnique.mockResolvedValue({ id: "oa1", liffId: "1111-liff" });
    mp.liveSession.findFirst.mockResolvedValue({ id: "SESSION_INTERNAL_ID", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: new Date("2026-08-20T09:00:00Z"), endsAt: null });
    mp.liveTeam.upsert.mockResolvedValue({ id: "TEAM_INTERNAL_ID", origin: "UZU_PRO" });
    mp.liveTicketLinkToken.create.mockResolvedValue({ id: "TOKEN_INTERNAL_ID" });
    const json = await (await linkPost(postReq({ workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1", capacity: 4 }))).json();
    const body = JSON.stringify(json);
    for (const v of ["SESSION_INTERNAL_ID", "TEAM_INTERNAL_ID", "TOKEN_INTERNAL_ID"]) expect(body).not.toContain(v);
    for (const k of ["tokenRecordId", "teamId", "liveSessionId"]) expect(body).not.toContain(k);
  });
});

// ───────── パス分離（20-24）─────────
describe("API パス分離（v1 に匿名 API を残さない）", () => {
  const root = process.cwd();
  it("20: v1 ticket-links は GET を持たない（POST のみ）", () => {
    expect(typeof v1TicketLinks.POST).toBe("function");
    expect((v1TicketLinks as Record<string, unknown>).GET).toBeUndefined();
  });
  it("21,22: v1 に revoke / sessions route を追加していない", () => {
    expect(existsSync(pathResolve(root, "src/app/api/external/v1/live/ticket-links/revoke/route.ts"))).toBe(false);
    expect(existsSync(pathResolve(root, "src/app/api/external/v1/live/sessions/route.ts"))).toBe(false);
  });
  it("23: v2 route が正しいパスに存在する", () => {
    for (const p of [
      "src/app/api/external/v2/live/sessions/route.ts",
      "src/app/api/external/v2/live/ticket-links/route.ts",
      "src/app/api/external/v2/live/ticket-links/revoke/route.ts",
    ]) expect(existsSync(pathResolve(root, p))).toBe(true);
  });
  it("24: docs が v2 パスを記載し、旧 v1 匿名パスの表記を残さない", () => {
    const doc = readFileSync(pathResolve(root, "docs/EXTERNAL_API.md"), "utf-8");
    expect(doc).toContain("/api/external/v2/live/sessions");
    expect(doc).toContain("/api/external/v2/live/ticket-links");
    expect(doc).toContain("/api/external/v2/live/ticket-links/revoke");
    // v1 に匿名 sessions/revoke パスを載せていない
    expect(doc).not.toContain("/api/external/v1/live/sessions");
    expect(doc).not.toContain("/api/external/v1/live/ticket-links/revoke");
  });
});
