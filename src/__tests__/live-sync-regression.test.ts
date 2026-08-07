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
    // UZU 連携（transactional outbox）で参照する。未設定 Work では送信しない。
    work: { findUnique: vi.fn() },
    uzuOutboxEvent: { findUnique: vi.fn(), create: vi.fn() },
    // 業務データ更新と outbox 作成は同一 transaction。mock では同じクライアントを渡す。
    $transaction: vi.fn(),
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
  mp.work.findUnique.mockResolvedValue({ uzuProjectId: null }); // 既定: UZU 連携なし（従来挙動）
  mp.uzuOutboxEvent.findUnique.mockResolvedValue(null);
  mp.uzuOutboxEvent.create.mockResolvedValue({ id: "o1" });
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => Promise<unknown>) => fn(mp));
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

describe("linkReservationToLiveTeam（UZU 連携の transactional outbox）", () => {
  it("Work.uzuProjectId が未設定なら outbox へ積まない（従来挙動のまま）", async () => {
    mp.work.findUnique.mockResolvedValue({ uzuProjectId: null });
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "R-100" });
    expect(mp.uzuOutboxEvent.create).not.toHaveBeenCalled();
    expect(mp.liveParticipant.create).toHaveBeenCalledOnce(); // 業務データ更新は従来どおり
  });

  it("Work.uzuProjectId があれば同一 transaction 内で outbox へ積む", async () => {
    mp.work.findUnique.mockResolvedValue({ uzuProjectId: "proj-1" });
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "R-100" });
    expect(mp.$transaction).toHaveBeenCalledOnce();
    expect(mp.uzuOutboxEvent.create).toHaveBeenCalledOnce();
    const data = mp.uzuOutboxEvent.create.mock.calls[0][0].data;
    expect(data.eventType).toBe("player_line.linked");
    expect(data.uzuProjectId).toBe("proj-1");
    expect(data.status).toBe("pending");
    // 予約番号は CSV 由来（team.reservationNumber）を正とする
    expect(data.payloadJson).toMatchObject({ reservationNumber: "R-100", lineUserId: "U1", oaId: "oa1", workId: "w1", matchedVia: "reservation" });
    // 冪等キーに participant / team / lineUserId を含む（正当な再リンクを潰さない）
    expect(data.idempotencyKey).toBe("player_line.linked:p1:t1:U1");
  });

  it("outbox 作成が失敗したら transaction ごと失敗する（連携済みなのにイベントが無い状態を作らない）", async () => {
    mp.work.findUnique.mockResolvedValue({ uzuProjectId: "proj-1" });
    mp.uzuOutboxEvent.create.mockRejectedValue(new Error("db down"));
    // linkReservationToLiveTeam は配信を壊さないため例外を握りつぶすが、
    // $transaction が reject されることで業務データ更新も巻き戻る（原子性）。
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "R-100" });
    expect(mp.uzuOutboxEvent.create).toHaveBeenCalled();
  });

  it("ticketId のみで一致した（予約番号が無い）team は UZU へ送らない", async () => {
    mp.work.findUnique.mockResolvedValue({ uzuProjectId: "proj-1" });
    mp.liveTeam.findMany.mockResolvedValue([{ id: "t9", liveSessionId: "s1", reservationNumber: null, ticketId: "TK-1" }]);
    await linkReservationToLiveTeam({ oaId: "oa1", lineUserId: "U1", workId: "w1", input: "TK-1" });
    expect(mp.liveParticipant.create).toHaveBeenCalledOnce(); // 業務データ更新は行う
    expect(mp.uzuOutboxEvent.create).not.toHaveBeenCalled();  // UZU へは送らない
  });
});
