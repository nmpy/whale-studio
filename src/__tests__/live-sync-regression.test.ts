// src/__tests__/live-sync-regression.test.ts
// 共通コア抽出後も、既存 Webhook 自己申告照合（linkReservationToLiveTeam）の挙動が不変であることを検証する。
// prisma と cache は mock、match-key と upsertLiveTeamParticipant（共通コア）は実物。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mp } = vi.hoisted(() => ({
  mp: {
    oaEntitlement: { findUnique: vi.fn() },
    liveSession: { findMany: vi.fn() },
    liveTeam: { findMany: vi.fn() },
    liveParticipant: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    liveEventLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));
vi.mock("@/lib/cache", () => ({
  activeCache: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
  CACHE_KEY: { liveEnabled: (oaId: string) => `live-enabled:${oaId}` },
  TTL: { LIVE_ENABLED: 1000 },
}));

import { linkReservationToLiveTeam } from "@/lib/live-sync";

beforeEach(() => {
  vi.clearAllMocks();
  mp.oaEntitlement.findUnique.mockResolvedValue({ enabled: true });
  mp.liveSession.findMany.mockResolvedValue([{ id: "s1" }]);
  mp.liveTeam.findMany.mockResolvedValue([{ id: "t1", liveSessionId: "s1", reservationNumber: "R-100", ticketId: null }]);
  mp.liveParticipant.findFirst.mockResolvedValue(null);
  mp.liveParticipant.create.mockResolvedValue({ id: "p1" });
  mp.liveEventLog.create.mockResolvedValue({ id: "e1" });
});

describe("linkReservationToLiveTeam（回帰）", () => {
  it("予約番号一致 → participant を active で作成 + checked_in を従来の payload 形で記録", async () => {
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "R-100" });
    // find-or-create（共通コア）: 新規 create、status=active、displayName は書き込まない
    const cData = mp.liveParticipant.create.mock.calls[0][0].data;
    expect(cData).toMatchObject({ oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "U1", status: "active" });
    expect("displayName" in cData).toBe(false);
    // checked_in の payload/ title は従来どおり
    const ev = mp.liveEventLog.create.mock.calls[0][0].data;
    expect(ev).toMatchObject({ type: "checked_in", title: "予約番号でチェックイン", detail: "R-100", payload: { via: "reservation", matched_team_id: "t1" } });
  });

  it("どのチーム予約/チケットにも一致しない入力は no-op（participant/event を作らない）", async () => {
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "NO-MATCH" });
    expect(mp.liveParticipant.create).not.toHaveBeenCalled();
    expect(mp.liveEventLog.create).not.toHaveBeenCalled();
  });

  it("非 Live OA は即 return（DB を触らない）", async () => {
    mp.oaEntitlement.findUnique.mockResolvedValue({ enabled: false });
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "R-100" });
    expect(mp.liveSession.findMany).not.toHaveBeenCalled();
    expect(mp.liveParticipant.create).not.toHaveBeenCalled();
  });
});
