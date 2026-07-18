// src/__tests__/live-participant-link.test.ts
// 共通コア upsertLiveTeamParticipant と、定員つき・行ロック連携 linkLineUserToResolvedLiveTeam のテスト。
// prisma は mock。$transaction は fn(tx=mp) を実行、$queryRaw(FOR UPDATE) は no-op。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mp } = vi.hoisted(() => ({
  mp: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    liveParticipant: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    liveTicketLinkToken: { updateMany: vi.fn() },
    liveEventLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { linkLineUserToResolvedLiveTeam, teamCapacity, upsertLiveTeamParticipant } from "@/lib/live-participant-link";

const NOW = new Date("2026-08-01T00:00:00Z");
const base = {
  oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "Unew",
  tokenId: "tok1", via: "liff_ticket", now: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
  mp.$queryRaw.mockResolvedValue([]);
  mp.liveParticipant.findMany.mockResolvedValue([]);
  mp.liveParticipant.create.mockResolvedValue({ id: "pNew" });
  mp.liveParticipant.update.mockResolvedValue({ id: "pE" });
  mp.liveTicketLinkToken.updateMany.mockResolvedValue({ count: 1 });
  mp.liveEventLog.create.mockResolvedValue({ id: "e1" });
});

describe("teamCapacity", () => {
  it("two=2 / four=4 / null・未知値=上限なし(null)", () => {
    expect(teamCapacity("two")).toBe(2);
    expect(teamCapacity("four")).toBe(4);
    expect(teamCapacity(null)).toBeNull();
    expect(teamCapacity(undefined)).toBeNull();
    expect(teamCapacity("six")).toBeNull();
  });
});

describe("linkLineUserToResolvedLiveTeam — 定員", () => {
  it("two・既存1人 → 新規連携成功（token 日時更新 + checked_in を記録）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue(null);                // 新規
    mp.liveParticipant.findMany.mockResolvedValue([{ lineUserId: "Ua" }]); // 既存1人
    const r = await linkLineUserToResolvedLiveTeam({ ...base, groupType: "two" });
    expect(r).toEqual({ kind: "linked", participantId: "pNew", created: true });
    expect(mp.$queryRaw).toHaveBeenCalled();                            // FOR UPDATE ロック
    expect(mp.liveParticipant.create).toHaveBeenCalled();
    // firstUsedAt は null のときだけ / lastUsedAt は毎回
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tok1", firstUsedAt: null }, data: { firstUsedAt: NOW } }));
    expect(mp.liveTicketLinkToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tok1" }, data: { lastUsedAt: NOW } }));
    // checked_in（既存 enum 再利用）+ payload via
    const ev = mp.liveEventLog.create.mock.calls[0][0].data;
    expect(ev.type).toBe("checked_in");
    expect(ev.payload).toMatchObject({ via: "liff_ticket", matched_team_id: "t1" });
  });

  it("two・既存2人 → 3人目は TEAM_FULL（token/participant/event を一切変更しない）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue(null);
    mp.liveParticipant.findMany.mockResolvedValue([{ lineUserId: "Ua" }, { lineUserId: "Ub" }]);
    const r = await linkLineUserToResolvedLiveTeam({ ...base, groupType: "two" });
    expect(r).toEqual({ kind: "team_full" });
    expect(mp.liveParticipant.create).not.toHaveBeenCalled();
    expect(mp.liveParticipant.update).not.toHaveBeenCalled();
    expect(mp.liveTicketLinkToken.updateMany).not.toHaveBeenCalled();
    expect(mp.liveEventLog.create).not.toHaveBeenCalled();
  });

  it("four・既存4人 → 5人目は TEAM_FULL", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue(null);
    mp.liveParticipant.findMany.mockResolvedValue([{ lineUserId: "a" }, { lineUserId: "b" }, { lineUserId: "c" }, { lineUserId: "d" }]);
    const r = await linkLineUserToResolvedLiveTeam({ ...base, groupType: "four" });
    expect(r.kind).toBe("team_full");
  });

  it("groupType 未設定 → 上限なし（多人数でも連携成功）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue(null);
    mp.liveParticipant.findMany.mockResolvedValue([{ lineUserId: "a" }, { lineUserId: "b" }, { lineUserId: "c" }, { lineUserId: "d" }, { lineUserId: "e" }]);
    const r = await linkLineUserToResolvedLiveTeam({ ...base, groupType: null });
    expect(r.kind).toBe("linked");
    // 上限なしのときは人数カウントすらしない
    expect(mp.liveParticipant.findMany).not.toHaveBeenCalled();
  });

  it("定員到達後でも既連携ユーザーは冪等成功（定員判定をスキップ・event/token 不変）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue({ id: "pE", status: "active" }); // 既連携
    const r = await linkLineUserToResolvedLiveTeam({ ...base, groupType: "two" });
    expect(r).toEqual({ kind: "linked", participantId: "pE", created: false });
    expect(mp.liveParticipant.findMany).not.toHaveBeenCalled(); // 定員判定なし
    expect(mp.liveParticipant.create).not.toHaveBeenCalled();
    expect(mp.liveTicketLinkToken.updateMany).not.toHaveBeenCalled(); // lastUsedAt 更新しない
    expect(mp.liveEventLog.create).not.toHaveBeenCalled();            // checked_in を増やさない
  });

  it("定員カウントは DISTINCT lineUserId・同一team・非null・全status（別team/匿名を数えない）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue(null);
    mp.liveParticipant.findMany.mockResolvedValue([]);
    await linkLineUserToResolvedLiveTeam({ ...base, groupType: "four" });
    expect(mp.liveParticipant.findMany).toHaveBeenCalledWith({
      where:    { liveSessionId: "s1", teamId: "t1", lineUserId: { not: null } },
      select:   { lineUserId: true },
      distinct: ["lineUserId"],
    });
  });
});

describe("upsertLiveTeamParticipant — 共通コア（webhook と同挙動）", () => {
  it("新規は status=active で create（displayName 未指定なら書き込まない）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue(null);
    const r = await upsertLiveTeamParticipant(mp as never, { oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "U1", now: NOW });
    expect(r).toEqual({ participantId: "pNew", created: true, priorStatus: null });
    const data = mp.liveParticipant.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "U1", status: "active" });
    expect("displayName" in data).toBe(false);
  });
  it("既存 dropped/completed は status を据え置き（active に戻さない）", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue({ id: "pD", status: "dropped" });
    await upsertLiveTeamParticipant(mp as never, { oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "U1", now: NOW });
    const data = mp.liveParticipant.update.mock.calls[0][0].data;
    expect("status" in data).toBe(false); // status を触らない
    expect(data.teamId).toBe("t1");
  });
  it("既存 active 等は active に更新", async () => {
    mp.liveParticipant.findFirst.mockResolvedValue({ id: "pW", status: "waiting" });
    await upsertLiveTeamParticipant(mp as never, { oaId: "oa1", liveSessionId: "s1", teamId: "t1", lineUserId: "U1", now: NOW });
    expect(mp.liveParticipant.update.mock.calls[0][0].data.status).toBe("active");
  });
});
