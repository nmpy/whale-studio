/**
 * src/__tests__/beacon-handler-controls.test.ts
 *
 * handleBeaconEvent に追加した再発火制御（有効期間 / 1回限り / 上限）と
 * messageId / isTest 記録の検証。Prisma / LINE 送信は注入モックで差し替える。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleBeaconEvent, type LineBeaconEvent, type BeaconLineGateway } from "@/lib/beacon";

type TriggerShape = {
  id: string; oaId: string; workId: string | null; name: string; hwid: string;
  enabled: boolean; eventTypes: string; cooldownSeconds: number;
  oncePerUser: boolean; maxTriggersPerUser: number | null;
  validFrom: Date | null; validTo: Date | null;
  actionType: string; actionPayload: unknown;
};

function makePrisma(opts: {
  trigger: Partial<TriggerShape> | null;
  successCount?: number;       // beaconEventLog.count の戻り（once/max 判定用）
  recentLog?: { id: string; createdAt: Date } | null;
}) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    beaconTrigger: { findUnique: vi.fn(async () => opts.trigger ?? null) },
    beaconEventLog: {
      findUnique: vi.fn(async () => null),                 // 重複なし
      findFirst:  vi.fn(async () => opts.recentLog ?? null),
      count:      vi.fn(async () => opts.successCount ?? 0),
      create:     vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: "log", ...data }; }),
    },
    lineDestination: { findUnique: vi.fn(async () => null) },
  };
}

function makeLine(): { gw: BeaconLineGateway; reply: ReturnType<typeof vi.fn>; push: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(async () => {});
  const push = vi.fn(async () => {});
  return { gw: { reply, push }, reply, push };
}

const OA = { id: "oa-1", channelAccessToken: "token" };

function makeEvent(overrides: Partial<LineBeaconEvent> = {}): LineBeaconEvent {
  return {
    type: "beacon",
    timestamp: 1_700_000_000,
    replyToken: "reply-token",
    source: { type: "user", userId: "U_user_1" },
    webhookEventId: "wid-ctrl-1",
    deliveryContext: { isRedelivery: false },
    beacon: { hwid: "abc123", type: "enter" },
    ...overrides,
  };
}

const base: TriggerShape = {
  id: "trg-1", oaId: "oa-1", workId: "work-1", name: "受付", hwid: "abc123",
  enabled: true, eventTypes: "enter", cooldownSeconds: 0,
  oncePerUser: false, maxTriggersPerUser: null, validFrom: null, validTo: null,
  actionType: "send_message", actionPayload: { text: "ようこそ" },
};

const NOW = new Date("2026-06-13T12:00:00Z");
const now = () => NOW;

describe("handleBeaconEvent — 再発火制御", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validFrom が未来 → skipped_invalid_period（送信しない）", async () => {
    const prisma = makePrisma({ trigger: { ...base, validFrom: new Date("2026-06-14T00:00:00Z") } });
    const { gw, reply, push } = makeLine();
    const r = await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now });
    expect(prisma.created[0].actionStatus).toBe("skipped_invalid_period");
    expect(reply).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(r.status).toBe("ignored");
  });

  it("validTo が過去 → skipped_invalid_period", async () => {
    const prisma = makePrisma({ trigger: { ...base, validTo: new Date("2026-06-12T00:00:00Z") } });
    const { gw } = makeLine();
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now });
    expect(prisma.created[0].actionStatus).toBe("skipped_invalid_period");
  });

  it("有効期間内 → 送信される", async () => {
    const prisma = makePrisma({ trigger: { ...base, validFrom: new Date("2026-06-01T00:00:00Z"), validTo: new Date("2026-06-30T00:00:00Z") } });
    const { gw, reply } = makeLine();
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(prisma.created[0].actionStatus).toBe("sent");
  });

  it("oncePerUser かつ成功ログ済み → skipped_once_per_user", async () => {
    const prisma = makePrisma({ trigger: { ...base, oncePerUser: true }, successCount: 1 });
    const { gw, reply } = makeLine();
    const r = await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now });
    expect(prisma.created[0].actionStatus).toBe("skipped_once_per_user");
    expect(reply).not.toHaveBeenCalled();
    expect(r.status).toBe("ignored");
  });

  it("oncePerUser で成功ログ無し → 送信される", async () => {
    const prisma = makePrisma({ trigger: { ...base, oncePerUser: true }, successCount: 0 });
    const { gw, reply } = makeLine();
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(prisma.created[0].actionStatus).toBe("sent");
  });

  it("maxTriggersPerUser 到達 → skipped_max_per_user", async () => {
    const prisma = makePrisma({ trigger: { ...base, maxTriggersPerUser: 2 }, successCount: 2 });
    const { gw, reply } = makeLine();
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now });
    expect(prisma.created[0].actionStatus).toBe("skipped_max_per_user");
    expect(reply).not.toHaveBeenCalled();
  });

  it("ignoreLimits=true は once/max/cooldown を無視して送信", async () => {
    const prisma = makePrisma({ trigger: { ...base, oncePerUser: true, cooldownSeconds: 300 }, successCount: 5, recentLog: { id: "x", createdAt: NOW } });
    const { gw, reply } = makeLine();
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now, ignoreLimits: true });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(prisma.created[0].actionStatus).toBe("sent");
    expect(prisma.beaconEventLog.count).not.toHaveBeenCalled();
  });

  it("isTest=true はログに isTest を残す", async () => {
    const prisma = makePrisma({ trigger: { ...base } });
    const { gw } = makeLine();
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now, isTest: true });
    expect(prisma.created[0].isTest).toBe(true);
    expect(prisma.created[0].actionStatus).toBe("sent");
  });

  it("action_type=message: resolveMessage を通し、message_id をログに残す", async () => {
    const prisma = makePrisma({ trigger: { ...base, actionType: "message", actionPayload: { message_id: "msg-99" } } });
    const { gw, reply } = makeLine();
    const resolveMessage = vi.fn(async () => [{ type: "text" as const, text: "from chain" }]);
    await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now, resolveMessage });
    expect(resolveMessage).toHaveBeenCalledWith({ messageId: "msg-99", workId: "work-1" });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(prisma.created[0].actionStatus).toBe("sent");
    expect(prisma.created[0].messageId).toBe("msg-99");
  });

  it("action_type=message で messageId 未設定 → message_not_configured", async () => {
    const prisma = makePrisma({ trigger: { ...base, actionType: "message", actionPayload: {} } });
    const { gw, reply } = makeLine();
    const r = await handleBeaconEvent({ prisma: prisma as any, oa: OA, event: makeEvent(), line: gw, now, resolveMessage: vi.fn(async () => null) });
    expect(prisma.created[0].actionStatus).toBe("message_not_configured");
    expect(reply).not.toHaveBeenCalled();
    expect(r.status).toBe("ignored");
  });
});
