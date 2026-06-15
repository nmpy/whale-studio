/**
 * src/__tests__/pre-publish-check.test.ts
 * 公開前チェック(runPrePublishCheck) の集計・重大度ロジック検証。
 * prisma / getCurrentPlanTierForOa はモック。getPlanAccessState/FEATURE は実物（純関数）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockWork = { findUnique: vi.fn() };
const mockLiffPageConfig = { findMany: vi.fn() };
const mockBeaconTrigger = { count: vi.fn() };

vi.mock("@/lib/prisma", () => ({
  prisma: { work: mockWork, liffPageConfig: mockLiffPageConfig, beaconTrigger: mockBeaconTrigger },
}));

const mockPlanTier = vi.fn();
vi.mock("@/lib/plan-guard", () => ({
  getCurrentPlanTierForOa: (...a: unknown[]) => mockPlanTier(...a),
}));

// 既定: クリーンな作品（全項目 OK になる最小構成）。
function cleanWork(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1", oaId: "oa1", liffEnabled: false, followAction: "auto_start",
    oa: { id: "oa1", serviceSuspendedAt: null, liffId: null },
    messages: [
      { id: "m_start", kind: "start", messageType: "text", triggerKeyword: "はじめる",
        nextMessageId: null, correctAction: null, correctNextPhaseId: null,
        freeInputEnabled: false, freeInputVariableKey: null, freeInputNextMessageId: null,
        checkinTriggerType: null, checkinTriggerLocationId: null, checkinTriggerNextMessageId: null, checkinTriggerNextPhaseId: null,
        imageActionType: null, imageActionText: null, imageActionUrl: null, imageActionLiffPageId: null, imageActionPostbackData: null,
        quickReplies: null },
    ],
    phases: [{ id: "p1" }],
    locations: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLiffPageConfig.findMany.mockResolvedValue([]);
  mockBeaconTrigger.count.mockResolvedValue(0);
  mockPlanTier.mockResolvedValue("pro"); // Pro Max 相当（location 許可）
});

async function run(work: unknown) {
  mockWork.findUnique.mockResolvedValue(work);
  const { runPrePublishCheck } = await import("@/lib/pre-publish-check");
  return runPrePublishCheck("w1");
}

describe("runPrePublishCheck", () => {
  it("作品が無ければ null", async () => {
    const r = await run(null);
    expect(r).toBeNull();
  });

  it("クリーンな作品は ok / errorCount 0", async () => {
    const r = await run(cleanWork());
    expect(r?.ok).toBe(true);
    expect(r?.errorCount).toBe(0);
    expect(r?.items.find((i) => i.key === "start_message")?.status).toBe("ok");
  });

  it("開始メッセージ無し + 壊れた遷移先 → error 検出", async () => {
    const r = await run(cleanWork({
      messages: [
        { id: "m1", kind: "normal", messageType: "text", triggerKeyword: null,
          nextMessageId: "missing", correctAction: null, correctNextPhaseId: null,
          freeInputEnabled: false, freeInputVariableKey: null, freeInputNextMessageId: null,
          checkinTriggerType: null, checkinTriggerLocationId: null, checkinTriggerNextMessageId: null, checkinTriggerNextPhaseId: null,
          imageActionType: null, imageActionText: null, imageActionUrl: null, imageActionLiffPageId: null, imageActionPostbackData: null,
          quickReplies: null },
      ],
    }));
    expect(r?.ok).toBe(false);
    expect(r?.items.find((i) => i.key === "start_message")?.status).toBe("fail");
    expect(r?.items.find((i) => i.key === "broken_transitions")?.status).toBe("fail");
  });

  it("ロケーション利用 + 非 Pro Max → location_plan が fail(error)", async () => {
    mockPlanTier.mockResolvedValue("basic"); // location 不許可
    const r = await run(cleanWork({ locations: [{ id: "loc1" }] }));
    const item = r?.items.find((i) => i.key === "location_plan");
    expect(item?.status).toBe("fail");
    expect(item?.severity).toBe("error");
    expect(r?.ok).toBe(false);
  });

  it("ロケーション利用 + Pro Max → location_plan が ok", async () => {
    mockPlanTier.mockResolvedValue("pro");
    const r = await run(cleanWork({ locations: [{ id: "loc1" }] }));
    expect(r?.items.find((i) => i.key === "location_plan")?.status).toBe("ok");
  });

  it("OA 停止中 → oa_active が fail", async () => {
    const r = await run(cleanWork({ oa: { id: "oa1", serviceSuspendedAt: new Date(), liffId: null } }));
    expect(r?.items.find((i) => i.key === "oa_active")?.status).toBe("fail");
    expect(r?.ok).toBe(false);
  });

  it("ロケーション未使用なら location_plan は skip（プラン判定を呼ばない）", async () => {
    const r = await run(cleanWork());
    expect(r?.items.find((i) => i.key === "location_plan")?.status).toBe("skip");
    expect(mockPlanTier).not.toHaveBeenCalled();
  });
});
