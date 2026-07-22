// src/__tests__/live-origin.test.ts
// プロダクト境界 origin（NATIVE / UZU_PRO）の分離テスト。
//   - native Live 管理 API（/api/oas/[id]/live/*）は origin=NATIVE のみを扱う。
//   - external v2 サービス（live-external-session / live-ticket-mint）は origin=UZU_PRO のみを扱う。
//   - 子（Team/Token/Participant）は親 Session / 発行 token の origin を継承する。
//   - 同一 externalRef が偶然 NATIVE 行に一致した場合は tripwire で拒否（境界違反）。
// prisma は mock。native route は live-auth を mock で通過させ、where/create の origin を検証する。
// service 層（db 引数を取る純関数）は小さな mock db を直接渡して検証する。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const { mp } = vi.hoisted(() => ({
  mp: {
    work: { findUnique: vi.fn(), findFirst: vi.fn() },
    oa: { findUnique: vi.fn() },
    liveSession: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    liveTeam: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    liveTicketLinkToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    liveParticipant: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));
// native route の権限ガードは常に通過させ、以降の origin 分離ロジックだけを検証する。
vi.mock("@/lib/live-auth", () => ({
  authorizeLive: vi.fn(async () => ({ ok: true, via: "platform_admin", user: { id: "u1" } })),
  authorizeLiveSection: vi.fn(async () => ({ ok: true, via: "platform_admin", user: { id: "u1" } })),
}));

import { GET as sessionsGet, POST as sessionsPost } from "@/app/api/oas/[id]/live/sessions/route";
import { GET as sessionGet, PATCH as sessionPatch, DELETE as sessionDelete } from "@/app/api/oas/[id]/live/sessions/[sessionId]/route";
import { GET as teamsGet } from "@/app/api/oas/[id]/live/sessions/[sessionId]/teams/route";
import { POST as resolvePost } from "@/app/api/liff/tickets/resolve/route";

import { upsertExternalLiveSession, findExternalLiveSession } from "@/lib/live-external-session";
import { upsertAnonymousTeam, issueAnonymousTicketToken, revokeAnonymousBookingTokens } from "@/lib/live-ticket-mint";
import { upsertLiveTeamParticipant } from "@/lib/live-participant-link";
import { nativeOrigin, uzuProOrigin, NATIVE_ORIGIN, UZU_PRO_ORIGIN } from "@/lib/live-origin";

beforeEach(() => {
  vi.clearAllMocks();
});

// route helpers -----------------------------------------------------------
const jsonReq = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

// service-layer mock db（各 test で必要な model method だけ stub）------------
type AnyFn = ReturnType<typeof vi.fn>;
function mkDb(): Record<string, Record<string, AnyFn>> {
  return {
    liveSession: { upsert: vi.fn(), findFirst: vi.fn() },
    liveTeam: { upsert: vi.fn() },
    liveTicketLinkToken: { create: vi.fn(), updateMany: vi.fn() },
    liveParticipant: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

// ═══════════ 1,4,5,7,13: native Live 管理 API は NATIVE のみ ═══════════
describe("native Live API — origin=NATIVE 境界", () => {
  // 1: native create → origin NATIVE
  it("1: POST /sessions は create data に origin=NATIVE を付与する", async () => {
    mp.liveSession.create.mockResolvedValue({
      id: "s1", oaId: "oa1", workId: null, name: "公演A", status: "draft",
      startsAt: null, endsAt: null, createdAt: new Date(), updatedAt: new Date(), work: null,
    });
    const res = await sessionsPost(jsonReq("http://localhost/api/oas/oa1/live/sessions", "POST", { name: "公演A" }), { params: { id: "oa1" } });
    expect(res.status).toBe(201);
    expect(mp.liveSession.create.mock.calls[0][0].data.origin).toBe("NATIVE");
  });

  // 4: native list excludes UZU_PRO
  it("4: GET /sessions は findMany where に origin=NATIVE を付与する（UZU_PRO 非露出）", async () => {
    mp.liveSession.findMany.mockResolvedValue([]);
    await sessionsGet(jsonReq("http://localhost/api/oas/oa1/live/sessions", "GET"), { params: { id: "oa1" } });
    expect(mp.liveSession.findMany.mock.calls[0][0].where).toMatchObject({ oaId: "oa1", origin: "NATIVE" });
  });

  // 5: native detail/update/delete cannot operate on UZU_PRO（gate が NATIVE で 0 行 → 404・update/delete しない）
  it("5: UZU_PRO の session id は GET/PATCH/DELETE で 404（gate where.origin=NATIVE・update/delete なし）", async () => {
    mp.liveSession.findFirst.mockResolvedValue(null); // NATIVE gate に一致しない = UZU_PRO 行

    const g = await sessionGet(jsonReq("http://localhost/api/oas/oa1/live/sessions/s1", "GET"), { params: { id: "oa1", sessionId: "s1" } });
    expect(g.status).toBe(404);
    expect(mp.liveSession.findFirst.mock.calls[0][0].where).toMatchObject({ id: "s1", oaId: "oa1", origin: "NATIVE" });

    const p = await sessionPatch(jsonReq("http://localhost/api/oas/oa1/live/sessions/s1", "PATCH", { name: "x" }), { params: { id: "oa1", sessionId: "s1" } });
    expect(p.status).toBe(404);
    expect(mp.liveSession.update).not.toHaveBeenCalled();

    const d = await sessionDelete(jsonReq("http://localhost/api/oas/oa1/live/sessions/s1", "DELETE"), { params: { id: "oa1", sessionId: "s1" } });
    expect(d.status).toBe(404);
    expect(mp.liveSession.delete).not.toHaveBeenCalled();
  });

  // 7: NATIVE session cannot get UZU_PRO team（team gate も NATIVE で絞る）
  it("7: GET /sessions/:id/teams は session gate と team 一覧の両方に origin=NATIVE を付与する", async () => {
    mp.liveSession.findFirst.mockResolvedValue({ id: "s1" });
    mp.liveTeam.findMany.mockResolvedValue([]);
    await teamsGet(jsonReq("http://localhost/api/oas/oa1/live/sessions/s1/teams", "GET"), { params: { id: "oa1", sessionId: "s1" } });
    expect(mp.liveSession.findFirst.mock.calls[0][0].where).toMatchObject({ id: "s1", oaId: "oa1", origin: "NATIVE" });
    expect(mp.liveTeam.findMany.mock.calls[0][0].where).toMatchObject({ liveSessionId: "s1", origin: "NATIVE" });
  });
});

// ═══════════ 2,14: external v2 create → UZU_PRO ＋ tripwire ═══════════
describe("external v2 service — origin=UZU_PRO 生成 + tripwire", () => {
  const sessionArgs = { oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1", startsAt: null, endsAt: null };

  // 2: external v2 create → origin UZU_PRO（session / team / token すべて）
  it("2a: upsertExternalLiveSession は create.origin=UZU_PRO", async () => {
    const db = mkDb();
    db.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    await upsertExternalLiveSession(db as never, sessionArgs);
    expect(db.liveSession.upsert.mock.calls[0][0].create.origin).toBe("UZU_PRO");
  });
  it("2b: upsertAnonymousTeam は create.origin=UZU_PRO", async () => {
    const db = mkDb();
    db.liveTeam.upsert.mockResolvedValue({ id: "team1", origin: "UZU_PRO" });
    await upsertAnonymousTeam(db as never, { oaId: "oa1", liveSessionId: "s1", externalBookingRef: "uzu-b-1", capacity: 4 });
    expect(db.liveTeam.upsert.mock.calls[0][0].create.origin).toBe("UZU_PRO");
  });
  it("2c: issueAnonymousTicketToken は create.data.origin=UZU_PRO", async () => {
    const db = mkDb();
    db.liveTicketLinkToken.create.mockResolvedValue({ id: "tok1" });
    await issueAnonymousTicketToken(db as never, {
      oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1",
      liveSessionId: "s1", teamId: "team1", liffId: "1111-liff", expiresAt: new Date(Date.now() + 8.64e7),
    });
    expect(db.liveTicketLinkToken.create.mock.calls[0][0].data.origin).toBe("UZU_PRO");
  });

  // 14: same external ref does NOT cross origin（偶然 NATIVE 行に一致したら境界違反として throw）
  it("14a: upsertExternalLiveSession が NATIVE 行に一致したら throw（NATIVE を操作しない）", async () => {
    const db = mkDb();
    db.liveSession.upsert.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "NATIVE", startsAt: null, endsAt: null });
    await expect(upsertExternalLiveSession(db as never, sessionArgs)).rejects.toThrow(/origin boundary violation/);
  });
  it("14b: upsertAnonymousTeam が NATIVE 行に一致したら throw", async () => {
    const db = mkDb();
    db.liveTeam.upsert.mockResolvedValue({ id: "team1", origin: "NATIVE" });
    await expect(
      upsertAnonymousTeam(db as never, { oaId: "oa1", liveSessionId: "s1", externalBookingRef: "uzu-b-1", capacity: 4 }),
    ).rejects.toThrow(/origin boundary violation/);
  });
});

// ═══════════ 6: external v2 は NATIVE を get/revoke できない（where.origin=UZU_PRO）═══════════
describe("external v2 service — read/revoke は UZU_PRO 限定", () => {
  it("6a: findExternalLiveSession の where.origin=UZU_PRO", async () => {
    const db = mkDb();
    db.liveSession.findFirst.mockResolvedValue({ id: "s1", externalSessionRef: "uzu-s-1", status: "draft", origin: "UZU_PRO", startsAt: null, endsAt: null });
    await findExternalLiveSession(db as never, { oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1" });
    expect(db.liveSession.findFirst.mock.calls[0][0].where.origin).toBe("UZU_PRO");
  });
  it("6b: revokeAnonymousBookingTokens の updateMany where.origin=UZU_PRO", async () => {
    const db = mkDb();
    db.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 0 });
    await revokeAnonymousBookingTokens(db as never, { oaId: "oa1", workId: "w1", externalSessionRef: "uzu-s-1", externalBookingRef: "uzu-b-1" });
    expect(db.liveTicketLinkToken.updateMany.mock.calls[0][0].where.origin).toBe("UZU_PRO");
  });
});

// ═══════════ 3: 子は親/token の origin を継承 ═══════════
describe("upsertLiveTeamParticipant — origin 継承", () => {
  const base = { oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "U1", now: new Date() };
  it("3: origin=UZU_PRO を渡すと create.data.origin=UZU_PRO", async () => {
    const db = mkDb();
    db.liveParticipant.findFirst.mockResolvedValue(null);
    db.liveParticipant.create.mockResolvedValue({ id: "p1" });
    await upsertLiveTeamParticipant(db as never, { ...base, origin: UZU_PRO_ORIGIN });
    expect(db.liveParticipant.create.mock.calls[0][0].data.origin).toBe("UZU_PRO");
  });
  it("3b: origin 未指定は既定 NATIVE（webhook 経路の回帰なし）", async () => {
    const db = mkDb();
    db.liveParticipant.findFirst.mockResolvedValue(null);
    db.liveParticipant.create.mockResolvedValue({ id: "p1" });
    await upsertLiveTeamParticipant(db as never, base);
    expect(db.liveParticipant.create.mock.calls[0][0].data.origin).toBe("NATIVE");
  });
});

// ═══════════ 9: LIFF resolve は origin フィルタ無しで token を引く（両 origin 解決）═══════════
describe("LIFF resolve — token lookup は origin で絞らない", () => {
  it("9: resolve の findUnique where は { tokenHash } のみ（NATIVE / UZU_PRO 両方解決）", async () => {
    mp.liveTicketLinkToken.findUnique.mockResolvedValue(null); // TOKEN_NOT_FOUND で早期 return（where は記録される）
    await resolvePost(jsonReq("http://localhost/api/liff/tickets/resolve", "POST", { token: "x".repeat(43) }));
    const where = mp.liveTicketLinkToken.findUnique.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(["tokenHash"]);
    expect("origin" in where).toBe(false);
  });
});

// ═══════════ 13: 同一 OA が NATIVE と UZU_PRO を同居できる（排他制約なし）═══════════
describe("同一 OA の共存（origin だけが異なる）", () => {
  it("13: 同一 oaId の native where と v2 where は origin のみが異なる", () => {
    const oaId = "oa1";
    const nativeWhere = { oaId, ...nativeOrigin() };
    const v2Where = { oaId, ...uzuProOrigin() };
    // 同じ oaId 配下で両者が併存できる（OA レベルの排他は存在しない）。
    expect(nativeWhere.oaId).toBe(v2Where.oaId);
    expect(nativeWhere.origin).toBe("NATIVE");
    expect(v2Where.origin).toBe("UZU_PRO");
    expect(nativeWhere.origin).not.toBe(v2Where.origin);
    expect(NATIVE_ORIGIN).toBe("NATIVE");
    expect(UZU_PRO_ORIGIN).toBe("UZU_PRO");
  });
});

// ═══════════ 12: migration/schema の静的検証（既存行は default で NATIVE に backfill）═══════════
describe("migration / schema 静的検証", () => {
  const root = process.cwd();
  it("12a: migration が LiveOrigin enum と origin NOT NULL DEFAULT 'NATIVE' を追加する", () => {
    const sql = readFileSync(
      pathResolve(root, "prisma/migrations/20260720000026_add_live_origin/migration.sql"),
      "utf-8",
    );
    expect(sql).toContain(`CREATE TYPE "LiveOrigin"`);
    expect(sql).toContain(`ADD COLUMN     "origin"`);
    expect(sql).toContain(`DEFAULT 'NATIVE'`);
    expect(sql).toContain("NOT NULL");
    // 4 モデルすべてに列追加（既存行は default で NATIVE に backfill）。
    for (const t of ["live_sessions", "live_teams", "live_ticket_link_tokens", "live_participants"]) {
      expect(sql).toContain(t);
    }
  });
  it("12b: schema.prisma が enum LiveOrigin と origin LiveOrigin @default(NATIVE) を持つ", () => {
    const schema = readFileSync(pathResolve(root, "prisma/schema.prisma"), "utf-8");
    expect(schema).toContain("enum LiveOrigin");
    expect(schema).toMatch(/origin\s+LiveOrigin\s+@default\(NATIVE\)/);
  });
});
