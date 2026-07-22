// src/__tests__/uzupro-status-view.test.ts
// for UZU Pro 連携状況 view-model（getUzuProStatusView / resolveUzuProCmsUrl）の集計・スコープ・PII 検証。
// prisma は mock。DB 側 count/groupBy/aggregate の where を検証する。

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mp } = vi.hoisted(() => ({
  mp: {
    liveSession: { count: vi.fn() },
    uzuProLiffLink: { groupBy: vi.fn(), count: vi.fn() },
    uzuProPlayer: { groupBy: vi.fn() },
    uzuProBooking: { aggregate: vi.fn() },
    uzuProSyncRequest: { count: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { getUzuProStatusView, resolveUzuProCmsUrl } from "@/lib/uzupro/status-view";

const OA = "oa1";
const WORK = "w1";

type Over = {
  sessions?: number;
  liffGroups?: Array<{ status: string; _count: number }>;
  playerGroups?: Array<{ status: string; _count: number }>;
  bookingAgg?: { _max: { syncedAt: Date | null } };
  failedSync?: number;
  errorLiff?: number;
};

function setup(over: Over = {}) {
  mp.liveSession.count.mockResolvedValue(over.sessions ?? 3);
  mp.uzuProLiffLink.groupBy.mockResolvedValue(
    over.liffGroups ?? [
      { status: "issued", _count: 2 },
      { status: "revoked", _count: 1 },
      { status: "linked", _count: 1 },
      { status: "error", _count: 1 },
    ],
  );
  mp.uzuProPlayer.groupBy.mockResolvedValue(
    over.playerGroups ?? [
      { status: "active", _count: 5 },
      { status: "cancelled", _count: 2 },
    ],
  );
  mp.uzuProBooking.aggregate.mockResolvedValue(over.bookingAgg ?? { _max: { syncedAt: new Date("2026-07-20T10:00:00.000Z") } });
  mp.uzuProSyncRequest.count.mockResolvedValue(over.failedSync ?? 1);
  mp.uzuProLiffLink.count.mockResolvedValue(over.errorLiff ?? 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.UZU_PRO_CMS_BASE_URL;
});

describe("getUzuProStatusView", () => {
  it("1,2: sessions は origin=UZU_PRO + oaId + workId のみ（NATIVE 除外）", async () => {
    setup();
    await getUzuProStatusView({ oaId: OA, workId: WORK });
    expect(mp.liveSession.count).toHaveBeenCalledWith({ where: { oaId: OA, workId: WORK, origin: "UZU_PRO" } });
  });

  it("3: 全クエリが oaId と workId でスコープ（他OA/他work混入防止）", async () => {
    setup();
    await getUzuProStatusView({ oaId: OA, workId: WORK });
    const liffWhere = mp.uzuProLiffLink.groupBy.mock.calls[0][0].where;
    expect(liffWhere.oaId).toBe(OA);
    expect(liffWhere.player.booking).toMatchObject({ oaId: OA, workId: WORK });
    const pWhere = mp.uzuProPlayer.groupBy.mock.calls[0][0].where;
    expect(pWhere.oaId).toBe(OA);
    expect(pWhere.booking).toMatchObject({ oaId: OA, workId: WORK });
    expect(mp.uzuProBooking.aggregate.mock.calls[0][0].where).toEqual({ oaId: OA, workId: WORK });
    expect(mp.uzuProSyncRequest.count.mock.calls[0][0].where).toMatchObject({ oaId: OA, workId: WORK, status: "failed" });
    const errLiffWhere = mp.uzuProLiffLink.count.mock.calls[0][0].where;
    expect(errLiffWhere).toMatchObject({ oaId: OA, status: "error" });
    expect(errLiffWhere.player.booking).toMatchObject({ oaId: OA, workId: WORK });
  });

  it("4: LIFF 状態別件数 + total が正しい", async () => {
    setup();
    const v = await getUzuProStatusView({ oaId: OA, workId: WORK });
    expect(v.liff).toEqual({ issued: 2, revoked: 1, linked: 1, error: 1, total: 5 });
  });

  it("5: player active/cancelled + total が正しい", async () => {
    setup();
    const v = await getUzuProStatusView({ oaId: OA, workId: WORK });
    expect(v.players).toEqual({ active: 5, cancelled: 2, total: 7 });
  });

  it("6: 最終予約同期 = UzuProBooking.syncedAt の最大値", async () => {
    setup();
    const v = await getUzuProStatusView({ oaId: OA, workId: WORK });
    expect(v.lastBookingSyncedAt).toEqual(new Date("2026-07-20T10:00:00.000Z"));
  });

  it("7: エラー内訳と total（内訳保持・二重計上しない）", async () => {
    setup({ failedSync: 2, errorLiff: 3 });
    const v = await getUzuProStatusView({ oaId: OA, workId: WORK });
    expect(v.errors).toEqual({ syncRequests: 2, liffLinks: 3, total: 5 });
  });

  it("8: 全 0 件（空状態）でも 0 を返す", async () => {
    setup({ sessions: 0, liffGroups: [], playerGroups: [], bookingAgg: { _max: { syncedAt: null } }, failedSync: 0, errorLiff: 0 });
    const v = await getUzuProStatusView({ oaId: OA, workId: WORK });
    expect(v.sessions).toBe(0);
    expect(v.liff).toEqual({ issued: 0, revoked: 0, linked: 0, error: 0, total: 0 });
    expect(v.players).toEqual({ active: 0, cancelled: 0, total: 0 });
    expect(v.lastBookingSyncedAt).toBeNull();
    expect(v.errors).toEqual({ syncRequests: 0, liffLinks: 0, total: 0 });
  });

  it("9: CMS URL 未設定でも失敗しない（cmsUrl=null）", async () => {
    setup();
    expect((await getUzuProStatusView({ oaId: OA, workId: WORK })).cmsUrl).toBeNull();
  });

  it("9b: CMS URL 設定時は返す / 不正・危険スキームは null", async () => {
    setup();
    process.env.UZU_PRO_CMS_BASE_URL = "https://cms.example.com/uzu";
    expect((await getUzuProStatusView({ oaId: OA, workId: WORK })).cmsUrl).toBe("https://cms.example.com/uzu");
    process.env.UZU_PRO_CMS_BASE_URL = "not-a-url";
    expect((await getUzuProStatusView({ oaId: OA, workId: WORK })).cmsUrl).toBeNull();
    process.env.UZU_PRO_CMS_BASE_URL = "javascript:alert(1)";
    expect((await getUzuProStatusView({ oaId: OA, workId: WORK })).cmsUrl).toBeNull();
  });

  it("10: view-model に PII / 内部ID が含まれない", async () => {
    process.env.UZU_PRO_CMS_BASE_URL = "https://cms.example.com";
    setup();
    const v = await getUzuProStatusView({ oaId: OA, workId: WORK });
    const s = JSON.stringify(v);
    for (const bad of ["email", "name", "phone", "address", "purchaser", "lineUserId", "line_user", "tokenHash", "token_hash", '"id"', "bookingId", "playerId"]) {
      expect(s).not.toContain(bad);
    }
  });
});

describe("resolveUzuProCmsUrl", () => {
  beforeEach(() => { delete process.env.UZU_PRO_CMS_BASE_URL; });
  it("未設定 → null", () => { expect(resolveUzuProCmsUrl()).toBeNull(); });
  it("空白のみ → null", () => { process.env.UZU_PRO_CMS_BASE_URL = "   "; expect(resolveUzuProCmsUrl()).toBeNull(); });
  it("https → 正規化して返す", () => { process.env.UZU_PRO_CMS_BASE_URL = "https://cms.example.com"; expect(resolveUzuProCmsUrl()).toBe("https://cms.example.com/"); });
  it("http → 返す", () => { process.env.UZU_PRO_CMS_BASE_URL = "http://localhost:3001/uzu"; expect(resolveUzuProCmsUrl()).toBe("http://localhost:3001/uzu"); });
  it("非 http(s) スキーム → null", () => { process.env.UZU_PRO_CMS_BASE_URL = "ftp://x"; expect(resolveUzuProCmsUrl()).toBeNull(); });
});
