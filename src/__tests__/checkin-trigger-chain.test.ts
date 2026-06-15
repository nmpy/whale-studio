/**
 * src/__tests__/checkin-trigger-chain.test.ts
 *
 * 地点到着で送信した next メッセージ自身に checkin_trigger があるとき、
 * 次地点を arm する「チェーン arm」の検証（consumeCheckinTrigger / consumeBeaconArrivalTrigger）。
 *
 * - QR / GPS / Beacon いずれの consume でも、送信した next メッセージに設定があれば次 pending を arm する
 * - 設定が無ければ arm しない
 * - consumed 済み（atomic claim で count=0）の再検知では push も arm も走らない
 * - idempotencyKey による upsert で重複 arm を防ぐ
 * - Beacon test-fire は consume 自体が走らない（handleBeaconEvent が onArrivalDetected を呼ばない）ため
 *   chain arm まで到達しない（= beacon-handler.test.ts でカバー。本ファイルは consume 以降を検証）。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCheckinWaitTrigger = { findFirst: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() };
const mockOa = { findUnique: vi.fn() };
const mockMessage = { findUnique: vi.fn(), findMany: vi.fn() };
const mockPhase = { findUnique: vi.fn() };
const mockUserProgress = { update: vi.fn() };
const mockWork = { findUnique: vi.fn() };
const mockLocation = { findUnique: vi.fn() };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    checkinWaitTrigger: mockCheckinWaitTrigger,
    oa:                 mockOa,
    message:            mockMessage,
    phase:              mockPhase,
    userProgress:       mockUserProgress,
    work:               mockWork,
    location:           mockLocation,
  },
}));

const mockPushToLine = vi.fn();
vi.mock("@/lib/line", () => ({
  pushToLine: (...a: unknown[]) => mockPushToLine(...a),
  // 送信メッセージ件数を records と同じにする（sentCount 用）。
  buildKeywordMessages: (records: unknown[]) => records.map(() => ({})),
}));

vi.mock("@/lib/cache", () => ({
  activeCache: { delete: vi.fn().mockResolvedValue(undefined) },
  CACHE_KEY:   { progress: (u: string, w: string) => `progress:${u}:${w}` },
}));

// next メッセージ B（チェーンなし）。loadMessageChain 用の shape。
const MSG_B_CHAIN = {
  id: "msgB", messageType: "text", body: "B", assetUrl: null, altText: null,
  flexPayloadJson: null, quickReplies: null, nextMessageId: null, sortOrder: 0,
  imageActionType: null, imageActionText: null, imageActionUrl: null,
  imageActionLiffPageId: null, imageActionPostbackData: null,
  lagMs: 0, freeInputEnabled: false, character: null,
};

function armRowForMsgB(triggerType: string) {
  // arm の findMany が返す「B に設定された次地点(C)トリガー」。
  return {
    id: "msgB", phaseId: null,
    checkinTriggerType: triggerType, checkinTriggerLocationId: "locC",
    checkinTriggerNextMessageId: "msgC", checkinTriggerNextPhaseId: null,
  };
}

const PENDING_TRIG = {
  id: "trigB", oaId: "oa-1", workId: "work-1", lineUserId: "U_user_1",
  locationId: "locB", triggerType: "qr", nextMessageId: "msgB", nextPhaseId: null,
  status: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOa.findUnique.mockResolvedValue({ channelAccessToken: "tok", title: "OA", serviceSuspendedAt: null });
  mockMessage.findUnique.mockResolvedValue(MSG_B_CHAIN);   // loadMessageChain(head=msgB)
  mockPushToLine.mockResolvedValue({ ok: true });
  mockCheckinWaitTrigger.updateMany.mockResolvedValue({ count: 1 });  // claim 成功
  mockCheckinWaitTrigger.upsert.mockResolvedValue({});
  mockWork.findUnique.mockResolvedValue({ oaId: "oa-1" });
});

describe("チェーン arm（地点到着で送信した next メッセージが次地点を arm）", () => {
  for (const triggerType of ["qr", "gps", "beacon"] as const) {
    it(`${triggerType} consume で送信した next メッセージに設定があれば次 pending を arm する`, async () => {
      const { consumeCheckinTrigger } = await import("@/lib/checkin-trigger");
      mockCheckinWaitTrigger.findFirst.mockResolvedValue({ ...PENDING_TRIG, triggerType });
      mockMessage.findMany.mockResolvedValue([armRowForMsgB(triggerType)]); // B に次地点 C の設定あり

      const result = await consumeCheckinTrigger({
        lineUserId: "U_user_1", workId: "work-1", locationId: "locB", triggerTypes: [triggerType],
      });

      expect(result.consumed).toBe(true);
      expect(result.sentCount).toBe(1);
      expect(mockPushToLine).toHaveBeenCalledTimes(1);
      // 次地点 C の pending を idempotencyKey 付きで upsert（チェーン arm）。
      expect(mockCheckinWaitTrigger.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = mockCheckinWaitTrigger.upsert.mock.calls[0][0];
      expect(upsertArg.where).toEqual({ idempotencyKey: `U_user_1:locC:msgB:${triggerType}` });
      expect(upsertArg.create).toMatchObject({ locationId: "locC", nextMessageId: "msgC", triggerType, status: "pending" });
    });
  }

  it("next メッセージに checkin_trigger 設定が無ければ何も arm しない", async () => {
    const { consumeCheckinTrigger } = await import("@/lib/checkin-trigger");
    mockCheckinWaitTrigger.findFirst.mockResolvedValue(PENDING_TRIG);
    mockMessage.findMany.mockResolvedValue([]); // B に設定なし

    const result = await consumeCheckinTrigger({
      lineUserId: "U_user_1", workId: "work-1", locationId: "locB", triggerTypes: ["qr"],
    });

    expect(result.consumed).toBe(true);
    expect(mockPushToLine).toHaveBeenCalledTimes(1);     // B は送信される
    expect(mockCheckinWaitTrigger.upsert).not.toHaveBeenCalled(); // 次地点 arm は無し
  });

  it("consumed 済み（claim count=0）の再検知では push も arm も走らない", async () => {
    const { consumeCheckinTrigger } = await import("@/lib/checkin-trigger");
    mockCheckinWaitTrigger.findFirst.mockResolvedValue(PENDING_TRIG);
    mockCheckinWaitTrigger.updateMany.mockResolvedValue({ count: 0 }); // 既に他経路/再検知で消化済み

    const result = await consumeCheckinTrigger({
      lineUserId: "U_user_1", workId: "work-1", locationId: "locB", triggerTypes: ["qr"],
    });

    expect(result.consumed).toBe(false);
    expect(mockPushToLine).not.toHaveBeenCalled();
    expect(mockCheckinWaitTrigger.upsert).not.toHaveBeenCalled();
  });

  it("pending が無いユーザーには送信も arm もしない", async () => {
    const { consumeCheckinTrigger } = await import("@/lib/checkin-trigger");
    mockCheckinWaitTrigger.findFirst.mockResolvedValue(null); // pending なし

    const result = await consumeCheckinTrigger({
      lineUserId: "U_user_1", workId: "work-1", locationId: "locB", triggerTypes: ["qr"],
    });

    expect(result.consumed).toBe(false);
    expect(mockCheckinWaitTrigger.updateMany).not.toHaveBeenCalled();
    expect(mockPushToLine).not.toHaveBeenCalled();
    expect(mockCheckinWaitTrigger.upsert).not.toHaveBeenCalled();
  });

  it("Beacon 経路（consumeBeaconArrivalTrigger）でも location→work 解決後に同じチェーン arm が走る", async () => {
    const { consumeBeaconArrivalTrigger } = await import("@/lib/checkin-trigger");
    mockLocation.findUnique.mockResolvedValue({ workId: "work-1" }); // locB → work-1
    mockCheckinWaitTrigger.findFirst.mockResolvedValue({ ...PENDING_TRIG, triggerType: "beacon" });
    mockMessage.findMany.mockResolvedValue([armRowForMsgB("beacon")]);

    const result = await consumeBeaconArrivalTrigger({ lineUserId: "U_user_1", locationId: "locB" });

    expect(result.consumed).toBe(true);
    expect(mockPushToLine).toHaveBeenCalledTimes(1);
    expect(mockCheckinWaitTrigger.upsert).toHaveBeenCalledTimes(1);
    expect(mockCheckinWaitTrigger.upsert.mock.calls[0][0].where).toEqual({ idempotencyKey: "U_user_1:locC:msgB:beacon" });
  });
});
