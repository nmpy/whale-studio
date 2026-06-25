/**
 * src/__tests__/scheduled-hold-chain-drain.test.ts
 *
 * PR-SER2 直列進行: drainAutoSendableItems が hold_chain_until_sent のメッセージで
 * 「自身まで送って後続を止める」こと＋ holdOut(参照引数)に resume cursor(nextMessageId) を記録すること。
 * hold OFF / enabled=false / 未設定 は従来挙動（止めない）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { drainAutoSendableItems } from "@/lib/runtime";
type PM = Parameters<typeof drainAutoSendableItems>[0][number];
let c = 0;
const sched = (o: { enabled?: boolean; hold?: boolean } | null) =>
  o ? JSON.stringify({ enabled: o.enabled ?? true, delay_minutes: 10, body: "x", hold_chain_until_sent: o.hold ?? false }) : null;
const mk = (o: Partial<PM> & { sched?: { enabled?: boolean; hold?: boolean } | null } = {}): PM => {
  c++;
  const { sched: sc, ...rest } = o;
  return ({
    id: o.id ?? `m${c}`, workId: "w", phaseId: "p", characterId: null, messageType: "text", body: "b",
    assetUrl: null, altText: null, flexPayloadJson: null, quickReplies: null, sortOrder: c, isActive: true,
    createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01"), kind: "normal", triggerKeyword: null,
    targetSegment: null, notifyText: null, riddleId: null, answer: null, answerMatchType: '["exact"]',
    correctAction: null, correctNextPhaseId: null, correctText: null, incorrectText: null, incorrectQuickReplies: null,
    puzzleHintText: null, puzzleType: null, nextMessageId: null, lagMs: 0, hintMode: "always", readReceiptMode: null,
    readDelayMs: null, typingEnabled: null, typingMinMs: null, typingMaxMs: null, loadingEnabled: null,
    loadingThresholdMs: null, loadingMinSeconds: null, loadingMaxSeconds: null, tapDestinationId: null, tapUrl: null,
    scheduledMessageSettings: sched(sc ?? null), character: null, ...rest,
  } as PM);
};
const ids = (r: { id: string }[]) => r.map((m) => m.id);

describe("drain hold truncation — flag OFF/未設定 は完全に現状維持", () => {
  afterEach(() => { delete process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION; });
  it("flag 未設定: hold ON でも truncation は発火せず後続まで送る", () => {
    delete process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION;
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2", sched: { hold: true } }), mk({ id: "m2", sortOrder: 0 })];
    const holdOut: { held?: { messageId: string; resumeFromMessageId: string | null } } = {};
    expect(ids(drainAutoSendableItems(msgs, "in_progress", undefined, holdOut))).toEqual(["m1", "m2"]);
    expect(holdOut.held).toBeUndefined();
  });
  it("flag=false（明示OFF）: hold ON でも止まらない", () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "false";
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2", sched: { hold: true } }), mk({ id: "m2", sortOrder: 0 })];
    expect(ids(drainAutoSendableItems(msgs, "in_progress"))).toEqual(["m1", "m2"]);
  });
});

describe("drain hold truncation (PR-SER2・flag ON)", () => {
  beforeEach(() => { process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true"; });
  afterEach(() => { delete process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION; });
  it("hold OFF: 後続まで通常どおり送られる", () => {
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2" }), mk({ id: "m2", sortOrder: 0 })];
    expect(ids(drainAutoSendableItems(msgs, "in_progress"))).toEqual(["m1", "m2"]);
  });

  it("1通目 hold ON: 1通目まで送られ 2通目は止まる + holdOut.resume = m2", () => {
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2", sched: { hold: true } }), mk({ id: "m2", sortOrder: 0 })];
    const holdOut: { held?: { messageId: string; resumeFromMessageId: string | null } } = {};
    expect(ids(drainAutoSendableItems(msgs, "in_progress", undefined, holdOut))).toEqual(["m1"]);
    expect(holdOut.held).toEqual({ messageId: "m1", resumeFromMessageId: "m2" });
  });

  it("2通目 hold ON: 1・2通目まで送られ 3通目以降が止まる + resume = m3", () => {
    const msgs = [
      mk({ id: "m1", sortOrder: 0, nextMessageId: "m2" }),
      mk({ id: "m2", sortOrder: 0, nextMessageId: "m3", sched: { hold: true } }),
      mk({ id: "m3", sortOrder: 0, nextMessageId: "m4" }),
      mk({ id: "m4", sortOrder: 0 }),
    ];
    const holdOut: { held?: { messageId: string; resumeFromMessageId: string | null } } = {};
    expect(ids(drainAutoSendableItems(msgs, "in_progress", undefined, holdOut))).toEqual(["m1", "m2"]);
    expect(holdOut.held).toEqual({ messageId: "m2", resumeFromMessageId: "m3" });
  });

  it("hold ON + 後続なし(nextMessageId=null): 送って停止・resumeFromMessageId=null", () => {
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: null, sched: { hold: true } })];
    const holdOut: { held?: { messageId: string; resumeFromMessageId: string | null } } = {};
    expect(ids(drainAutoSendableItems(msgs, "in_progress", undefined, holdOut))).toEqual(["m1"]);
    expect(holdOut.held).toEqual({ messageId: "m1", resumeFromMessageId: null });
  });

  it("enabled=false + hold=true は止めない（従来どおり後続も送る）", () => {
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2", sched: { enabled: false, hold: true } }), mk({ id: "m2", sortOrder: 0 })];
    const holdOut: { held?: { messageId: string; resumeFromMessageId: string | null } } = {};
    expect(ids(drainAutoSendableItems(msgs, "in_progress", undefined, holdOut))).toEqual(["m1", "m2"]);
    expect(holdOut.held).toBeUndefined();
  });

  it("scheduledMessageSettings 未設定は従来どおり（止めない）", () => {
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2", sched: null }), mk({ id: "m2", sortOrder: 0 })];
    expect(ids(drainAutoSendableItems(msgs, "in_progress"))).toEqual(["m1", "m2"]);
  });

  it("holdOut 省略でも truncation は動く（参照引数は任意）", () => {
    const msgs = [mk({ id: "m1", sortOrder: 0, nextMessageId: "m2", sched: { hold: true } }), mk({ id: "m2", sortOrder: 0 })];
    expect(ids(drainAutoSendableItems(msgs, "in_progress"))).toEqual(["m1"]);
  });
});
