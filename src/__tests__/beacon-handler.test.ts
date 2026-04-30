/**
 * src/__tests__/beacon-handler.test.ts
 *
 * handleBeaconEvent の振る舞い検証。
 * Prisma / LINE 送信は注入したモックで差し替える。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleBeaconEvent, type LineBeaconEvent, type BeaconLineGateway } from "@/lib/beacon";

// ── Prisma モック ─────────────────────────────────────────
function makePrismaMock(opts: {
  trigger?: Partial<{
    id: string;
    oaId: string;
    workId: string | null;
    name: string;
    hwid: string;
    enabled: boolean;
    eventTypes: string;
    cooldownSeconds: number;
    actionType: string;
    actionPayload: unknown;
  }> | null;
  /** webhookEventId → 既存ログ（重複排除テスト用） */
  existingLogByWebhookId?: Record<string, { id: string; actionStatus: string; beaconTriggerId: string | null }>;
  /** cooldown findFirst で返すレコード */
  recentLog?: { id: string; createdAt: Date } | null;
  /** lineDestination findUnique 結果 */
  destination?: {
    id: string;
    workId: string;
    destinationType: string;
    liffTargetType: string | null;
    urlOrPath: string | null;
    queryParamsJson: Record<string, string>;
    isEnabled: boolean;
  } | null;
}) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    beaconTrigger: {
      findUnique: vi.fn(async () => opts.trigger ?? null),
    },
    beaconEventLog: {
      findUnique: vi.fn(async ({ where: { webhookEventId } }: { where: { webhookEventId: string } }) =>
        opts.existingLogByWebhookId?.[webhookEventId] ?? null,
      ),
      findFirst: vi.fn(async () => opts.recentLog ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "log-mock-id", ...data };
      }),
    },
    lineDestination: {
      findUnique: vi.fn(async () => opts.destination ?? null),
    },
  };
}

// ── LINE Gateway モック ─────────────────────────────────────
function makeLineMock(opts: { replyImpl?: () => Promise<void>; pushImpl?: () => Promise<void> } = {}): {
  gw: BeaconLineGateway;
  reply: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async () => {
    if (opts.replyImpl) return opts.replyImpl();
  });
  const push = vi.fn(async () => {
    if (opts.pushImpl) return opts.pushImpl();
  });
  return { gw: { reply, push }, reply, push };
}

// ── 共通フィクスチャ ───────────────────────────────────────
const OA = { id: "oa-1", channelAccessToken: "token" };

function makeEvent(overrides: Partial<LineBeaconEvent> = {}): LineBeaconEvent {
  return {
    type: "beacon",
    timestamp: 1700000000,
    replyToken: "reply-token-123",
    source: { type: "user", userId: "U_user_1" },
    webhookEventId: "wid-001",
    deliveryContext: { isRedelivery: false },
    beacon: { hwid: "AbC123", type: "enter" },
    ...overrides,
  };
}

const baseTrigger = {
  id: "trg-1",
  oaId: "oa-1",
  workId: "work-1",
  name: "玄関ビーコン",
  hwid: "abc123",
  enabled: true,
  eventTypes: "enter",
  cooldownSeconds: 300,
  actionType: "send_message",
  actionPayload: { text: "ようこそ！" },
};

describe("handleBeaconEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("既存 webhookEventId は二重実行せず ignored を返す", async () => {
    const prisma = makePrismaMock({
      trigger: baseTrigger,
      existingLogByWebhookId: {
        "wid-001": { id: "log-1", actionStatus: "sent", beaconTriggerId: "trg-1" },
      },
    });
    const { gw, reply, push } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(result.reason).toMatch(/duplicate/);
    expect(reply).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(prisma.beaconEventLog.create).not.toHaveBeenCalled();
  });

  it("未登録 HWID はログを残し送信しない", async () => {
    const prisma = makePrismaMock({ trigger: null });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent({ beacon: { hwid: "DEADBEEF", type: "enter" } }),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(result.reason).toMatch(/no matching trigger/);
    expect(reply).not.toHaveBeenCalled();
    expect(prisma.beaconEventLog.create).toHaveBeenCalledTimes(1);
    const logged = prisma.created[0];
    expect(logged.actionStatus).toBe("ignored");
    expect(logged.hwid).toBe("deadbeef");
  });

  it("disabled trigger は送信しない", async () => {
    const prisma = makePrismaMock({ trigger: { ...baseTrigger, enabled: false } });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(reply).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("ignored");
    expect(prisma.created[0]?.errorMessage).toMatch(/disabled/);
  });

  it("beacon.type が enter 以外（stay）の場合、MVP では送信しない", async () => {
    const prisma = makePrismaMock({ trigger: baseTrigger });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent({ beacon: { hwid: "AbC123", type: "stay" } }),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(reply).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("ignored");
    expect(prisma.created[0]?.beaconType).toBe("stay");
  });

  it("cooldown 内なら cooldown ステータスで記録し、送信しない", async () => {
    const prisma = makePrismaMock({
      trigger: baseTrigger,
      recentLog: { id: "log-prev", createdAt: new Date() },
    });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("cooldown");
    expect(reply).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("cooldown");
  });

  it("cooldown 外なら通常通り送信する（reply 経由 / sent ログを保存）", async () => {
    const prisma = makePrismaMock({
      trigger: baseTrigger,
      recentLog: null,
    });
    const { gw, reply, push } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("sent");
    expect(reply).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    const [token, msgs] = reply.mock.calls[0];
    expect(token).toBe("reply-token-123");
    expect(msgs).toEqual([{ type: "text", text: "ようこそ！" }]);
    expect(prisma.created[0]?.actionStatus).toBe("sent");
  });

  it("送信失敗時も throw せず failed ログを残す", async () => {
    const prisma = makePrismaMock({ trigger: baseTrigger });
    const { gw, reply } = makeLineMock({
      replyImpl: async () => {
        throw new Error("LINE 401 Unauthorized");
      },
    });

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("failed");
    expect(reply).toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("failed");
    expect(prisma.created[0]?.errorMessage).toMatch(/401/);
  });

  it("destination アクションは LineDestination から URL を解決して送信する", async () => {
    const prisma = makePrismaMock({
      trigger: {
        ...baseTrigger,
        actionType: "destination",
        actionPayload: { destination_id: "dest-1", text: "圏内に入りました" },
      },
      destination: {
        id: "dest-1",
        workId: "work-1",
        destinationType: "external_url",
        liffTargetType: null,
        urlOrPath: "https://example.com/scene",
        queryParamsJson: {},
        isEnabled: true,
      },
    });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("sent");
    expect(reply).toHaveBeenCalledTimes(1);
    const [, msgs] = reply.mock.calls[0];
    expect((msgs[0] as { text: string }).text).toContain("https://example.com/scene");
    expect((msgs[0] as { text: string }).text).toContain("圏内に入りました");
  });

  it("不正な action 設定は failed として記録する", async () => {
    const prisma = makePrismaMock({
      trigger: { ...baseTrigger, actionType: "send_message", actionPayload: { text: "" } },
    });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("failed");
    expect(reply).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("failed");
  });

  it("HWID が不正形式の場合は ignored として記録する", async () => {
    const prisma = makePrismaMock({ trigger: null });
    const { gw } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent({ beacon: { hwid: "abc-#$", type: "enter" } }),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(prisma.created[0]?.actionStatus).toBe("ignored");
    expect(prisma.created[0]?.errorMessage).toMatch(/英数字/);
    // trigger 検索は走らない
    expect(prisma.beaconTrigger.findUnique).not.toHaveBeenCalled();
  });

  it("noop アクションは matched で記録し、送信しない", async () => {
    const prisma = makePrismaMock({
      trigger: { ...baseTrigger, actionType: "noop", actionPayload: null },
    });
    const { gw, reply, push } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("matched");
    expect(reply).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("matched");
  });
});
