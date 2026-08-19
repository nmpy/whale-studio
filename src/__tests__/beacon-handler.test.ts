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
    locationId: string | null;
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
    /** include: { work: { select: { publicId: true } } } の結果。canonical URL 用。 */
    work?: { publicId: string | null } | null;
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
    expect(logged.actionStatus).toBe("unknown_beacon");
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

  it("destination(liff) は OA の Oa.liffId で URL を組む（env の共通 LIFF を使わない）", async () => {
    // env にテスト用 LIFF が入っていても混入してはいけない。
    const saved = process.env.NEXT_PUBLIC_LIFF_ID;
    process.env.NEXT_PUBLIC_LIFF_ID = "2010049684-aJNy8Ljv";
    try {
      const prisma = makePrismaMock({
        trigger: {
          ...baseTrigger,
          actionType: "destination",
          actionPayload: { destination_id: "dest-liff" },
        },
        destination: {
          id: "dest-liff",
          workId: "work-1",
          destinationType: "liff",
          liffTargetType: null,
          urlOrPath: null,
          queryParamsJson: { param1: "sns" },
          isEnabled: true,
          work: { publicId: "wp0001" },
        },
      });
      const { gw, reply } = makeLineMock();

      const result = await handleBeaconEvent({
        prisma: prisma as any,
        oa: { ...OA, liffId: "2010632002-ZzzimCzc" },
        event: makeEvent(),
        line: gw,
      });

      expect(result.status).toBe("sent");
      const [, msgs] = reply.mock.calls[0];
      const text = (msgs[0] as { text: string }).text;
      // canonical: 作品ホーム /w/{workPublicId} + query 維持。?workId= にはしない。
      expect(text).toContain("https://liff.line.me/2010632002-ZzzimCzc/w/wp0001?param1=sns");
      expect(text).not.toContain("?workId=");
      expect(text).not.toContain("/p/");
      expect(text).not.toContain("2010049684");
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
      else process.env.NEXT_PUBLIC_LIFF_ID = saved;
    }
  });

  it("destination(liff) で Oa.liffId 未設定なら送信しない（env へ落ちない）", async () => {
    const saved = process.env.NEXT_PUBLIC_LIFF_ID;
    process.env.NEXT_PUBLIC_LIFF_ID = "2010049684-aJNy8Ljv";
    try {
      const prisma = makePrismaMock({
        trigger: {
          ...baseTrigger,
          actionType: "destination",
          actionPayload: { destination_id: "dest-liff" },
        },
        destination: {
          id: "dest-liff",
          workId: "work-1",
          destinationType: "liff",
          liffTargetType: null,
          urlOrPath: null,
          queryParamsJson: {},
          isEnabled: true,
          work: { publicId: "wp0001" },
        },
      });
      const { gw, reply } = makeLineMock();

      const result = await handleBeaconEvent({
        prisma: prisma as any,
        oa: { ...OA, liffId: null },
        event: makeEvent(),
        line: gw,
      });

      // 誤った LIFF URL を送るのではなく、設定不足として送信しない。
      expect(result.status).toBe("failed");
      const sentTexts = reply.mock.calls.flatMap(([, msgs]) =>
        (msgs as { text?: string }[]).map((m) => m.text ?? ""));
      expect(sentTexts.join("\n")).not.toContain("2010049684");
      expect(sentTexts.join("\n")).not.toContain("liff.line.me");
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
      else process.env.NEXT_PUBLIC_LIFF_ID = saved;
    }
  });

  it("destination(liff) で Work.publicId が無い旧データは legacy /work/{workId} へ落ちる", async () => {
    const prisma = makePrismaMock({
      trigger: {
        ...baseTrigger,
        actionType: "destination",
        actionPayload: { destination_id: "dest-liff" },
      },
      destination: {
        id: "dest-liff",
        workId: "work-1",
        destinationType: "liff",
        liffTargetType: null,
        urlOrPath: null,
        queryParamsJson: {},
        isEnabled: true,
        work: { publicId: null },
      },
    });
    const { gw, reply } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: { ...OA, liffId: "2010632002-ZzzimCzc" },
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("sent");
    const [, msgs] = reply.mock.calls[0];
    const text = (msgs[0] as { text: string }).text;
    expect(text).toContain("https://liff.line.me/2010632002-ZzzimCzc/work/work-1");
    expect(text).not.toContain("?workId=");
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

  it("action_type=message: resolveMessage が返したメッセージを reply 送信し sent ログ", async () => {
    const prisma = makePrismaMock({
      trigger: { ...baseTrigger, actionType: "message", actionPayload: { message_id: "msg-1" } },
    });
    const { gw, reply, push } = makeLineMock();
    const resolveMessage = vi.fn(async () => [{ type: "text", text: "登録メッセージ" } as const]);

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
      resolveMessage: resolveMessage as any,
    });

    expect(result.status).toBe("sent");
    expect(resolveMessage).toHaveBeenCalledWith({ messageId: "msg-1", workId: "work-1" });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(prisma.created[0]?.actionStatus).toBe("sent");
  });

  it("action_type=message で messageId 未設定なら message_not_configured で送信しない", async () => {
    const prisma = makePrismaMock({
      trigger: { ...baseTrigger, actionType: "message", actionPayload: {} },
    });
    const { gw, reply, push } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: OA,
      event: makeEvent(),
      line: gw,
      resolveMessage: (async () => null) as any,
    });

    expect(reply).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("message_not_configured");
  });

  it("OA 停止中（serviceSuspendedAt）は送信せず service_stopped ログ", async () => {
    const prisma = makePrismaMock({ trigger: { ...baseTrigger } });
    const { gw, reply, push } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: { ...OA, serviceSuspendedAt: new Date() },
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(result.reason).toBe("service_stopped");
    expect(reply).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("service_stopped");
  });

  it("プラン未許可（planAllowed=false）は送信せず plan_blocked ログ", async () => {
    const prisma = makePrismaMock({ trigger: { ...baseTrigger } });
    const { gw, reply, push } = makeLineMock();

    const result = await handleBeaconEvent({
      prisma: prisma as any,
      oa: { ...OA, planAllowed: false },
      event: makeEvent(),
      line: gw,
    });

    expect(result.status).toBe("ignored");
    expect(result.reason).toBe("plan_blocked");
    expect(reply).not.toHaveBeenCalled();
    expect(prisma.created[0]?.actionStatus).toBe("plan_blocked");
  });

  // ── 送信後の待機トリガー(地点到着で自動進行) consume フック ──
  describe("onArrivalDetected（地点到着で自動進行の消化フック）", () => {
    it("locationId 付き有効検知で locationId と共に1回呼ばれる", async () => {
      const prisma = makePrismaMock({ trigger: { ...baseTrigger, locationId: "loc-1" } });
      const { gw } = makeLineMock();
      const onArrivalDetected = vi.fn(async () => {});

      await handleBeaconEvent({
        prisma: prisma as any,
        oa: OA,
        event: makeEvent(),
        line: gw,
        onArrivalDetected,
      });

      expect(onArrivalDetected).toHaveBeenCalledTimes(1);
      expect(onArrivalDetected).toHaveBeenCalledWith({ lineUserId: "U_user_1", locationId: "loc-1" });
    });

    it("locationId 未設定なら呼ばれない（誤発火防止）", async () => {
      const prisma = makePrismaMock({ trigger: { ...baseTrigger, locationId: null } });
      const { gw } = makeLineMock();
      const onArrivalDetected = vi.fn(async () => {});

      await handleBeaconEvent({
        prisma: prisma as any,
        oa: OA,
        event: makeEvent(),
        line: gw,
        onArrivalDetected,
      });

      expect(onArrivalDetected).not.toHaveBeenCalled();
    });

    it("無効(disabled)トリガーでは検知前に弾かれ呼ばれない", async () => {
      const prisma = makePrismaMock({ trigger: { ...baseTrigger, locationId: "loc-1", enabled: false } });
      const { gw } = makeLineMock();
      const onArrivalDetected = vi.fn(async () => {});

      await handleBeaconEvent({
        prisma: prisma as any,
        oa: OA,
        event: makeEvent(),
        line: gw,
        onArrivalDetected,
      });

      expect(onArrivalDetected).not.toHaveBeenCalled();
    });

    it("consume は cooldown の影響を受けない（cooldown 中でも呼ばれる）", async () => {
      // cooldown 該当（recentLog あり）でも、arrival 消化は cooldown 判定より前に実行される。
      const prisma = makePrismaMock({
        trigger: { ...baseTrigger, locationId: "loc-1" },
        recentLog: { id: "recent", createdAt: new Date(1700000000000) },
      });
      const { gw } = makeLineMock();
      const onArrivalDetected = vi.fn(async () => {});

      await handleBeaconEvent({
        prisma: prisma as any,
        oa: OA,
        event: makeEvent(),
        line: gw,
        now: () => new Date(1700000000000),
        onArrivalDetected,
      });

      expect(onArrivalDetected).toHaveBeenCalledTimes(1);
    });

    it("コールバックが throw しても beacon 本処理は継続する", async () => {
      const prisma = makePrismaMock({ trigger: { ...baseTrigger, locationId: "loc-1" } });
      const { gw, reply } = makeLineMock();
      const onArrivalDetected = vi.fn(async () => { throw new Error("boom"); });

      const result = await handleBeaconEvent({
        prisma: prisma as any,
        oa: OA,
        event: makeEvent(),
        line: gw,
        onArrivalDetected,
      });

      // send_message アクションは通常どおり送信される（reply 優先）。
      expect(reply).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("sent");
    });
  });
});
