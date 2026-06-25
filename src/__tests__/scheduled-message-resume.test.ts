/**
 * src/__tests__/scheduled-message-resume.test.ts
 *
 * PR-SER3 resume アダプタ（makeResumeChain）: next_message_id から後続チェーンを drain→push→再arm。
 * IO（fetchPhaseMessages / pushChain / rearm）は mock。drain は実体（drainAutoSendableItemsFrom）を使う。
 *   - invalid next（不存在/inactive/別work）→ resumeFailed・push しない
 *   - 後続に予約なし → 送って終了
 *   - 後続が hold ON → そこで停止し holdOut.resume cursor を返す（= 再arm が次予約に保存し3段以上へ）
 *   - push 失敗 → 二重 push せず resumeFailed・再arm しない
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeResumeChain } from "@/lib/scheduled-message-resume";
import type { PendingScheduledRow } from "@/lib/scheduled-message-worker";
import type { PhaseRow } from "@/lib/runtime";
import type { RuntimePhaseMessage } from "@/types";

type PM = PhaseRow["messages"][number];
let c = 0;
const sched = (hold: boolean) => JSON.stringify({ enabled: true, delay_minutes: 10, body: "x", hold_chain_until_sent: hold });
const mk = (o: Partial<PM> & { hold?: boolean; scheduled?: boolean } = {}): PM => {
  c++;
  const { hold, scheduled, ...rest } = o;
  return ({
    id: o.id ?? `m${c}`, workId: "w1", phaseId: "p1", characterId: null, messageType: "text", body: "b",
    assetUrl: null, altText: null, flexPayloadJson: null, quickReplies: null, sortOrder: c, isActive: true,
    createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01"), kind: "normal", triggerKeyword: null,
    targetSegment: null, notifyText: null, riddleId: null, answer: null, answerMatchType: '["exact"]',
    correctAction: null, correctNextPhaseId: null, correctText: null, incorrectText: null, incorrectQuickReplies: null,
    puzzleHintText: null, puzzleType: null, nextMessageId: null, lagMs: 0, hintMode: "always", readReceiptMode: null,
    readDelayMs: null, typingEnabled: null, typingMinMs: null, typingMaxMs: null, loadingEnabled: null,
    loadingThresholdMs: null, loadingMinSeconds: null, loadingMaxSeconds: null, tapDestinationId: null, tapUrl: null,
    scheduledMessageSettings: scheduled ? sched(hold ?? false) : null, character: null, ...rest,
  } as PM);
};

const ROW: PendingScheduledRow = {
  id: "r1", workId: "w1", lineUserId: "U1", userProgressId: "up1", phaseId: "p1",
  cancelPolicyJson: null, oaId: "oa1", sourceMessageId: "m1", payloadJson: "{}", retryCount: 0,
};
const NOW = new Date("2026-06-26T00:00:00.000Z");

function adapter(messages: PM[] | null, over: { pushOk?: boolean; rearmCreated?: number; rearmThrows?: boolean } = {}) {
  const pushChain = vi.fn(async (_a: { row: PendingScheduledRow; messages: RuntimePhaseMessage[] }) =>
    (over.pushOk === false ? { ok: false, reason: "push_failed" } : { ok: true }));
  const rearm = vi.fn(async () => { if (over.rearmThrows) throw new Error("arm"); return { created: over.rearmCreated ?? 0 }; });
  const fetchPhaseMessages = vi.fn(async () => messages);
  return { chain: makeResumeChain({ fetchPhaseMessages, pushChain, rearm }), pushChain, rearm, fetchPhaseMessages };
}

describe("makeResumeChain (PR-SER3 adapter)", () => {
  beforeEach(() => { process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true"; });
  afterEach(() => { delete process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION; });

  it("後続に予約なし: m2 を送って終了（push 1回・再arm 呼ぶ・ok）", async () => {
    const msgs = [mk({ id: "m2", nextMessageId: "m3" }), mk({ id: "m3" })];
    const a = adapter(msgs);
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out.ok).toBe(true);
    expect(out.sentCount).toBe(2);                         // m2→m3 連続
    expect(a.pushChain).toHaveBeenCalledTimes(1);
    expect(a.pushChain.mock.calls[0][0].messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(a.rearm).toHaveBeenCalledWith(expect.objectContaining({ sentMessageIds: ["m2", "m3"] }));
    expect(out.nextResumeMessageId).toBeNull();
  });

  it("後続 m2 が hold ON: m2 まで送って停止・nextResume=m3・再arm に m2 を渡す（3段以上の起点）", async () => {
    const msgs = [mk({ id: "m2", nextMessageId: "m3", scheduled: true, hold: true }), mk({ id: "m3" })];
    const a = adapter(msgs, { rearmCreated: 1 });
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out.ok).toBe(true);
    expect(a.pushChain.mock.calls[0][0].messages.map((m) => m.id)).toEqual(["m2"]); // hold で打ち切り
    expect(out.nextResumeMessageId).toBe("m3");            // 次段 resume cursor
    expect(out.rearmed).toBe(1);
    expect(a.rearm).toHaveBeenCalledWith(expect.objectContaining({ sentMessageIds: ["m2"] }));
  });

  it("invalid next（不存在）: resumeFailed・push も再arm もしない", async () => {
    const a = adapter([mk({ id: "m2" })]);
    const out = await a.chain({ row: ROW, nextMessageId: "nope", now: NOW });
    expect(out).toMatchObject({ ok: false, reason: "invalid_next_message" });
    expect(a.pushChain).not.toHaveBeenCalled();
    expect(a.rearm).not.toHaveBeenCalled();
  });

  it("invalid next（inactive）: resumeFailed", async () => {
    const a = adapter([mk({ id: "m2", isActive: false })]);
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out).toMatchObject({ ok: false, reason: "invalid_next_message" });
  });

  it("invalid next（別 work）: resumeFailed", async () => {
    const a = adapter([mk({ id: "m2", workId: "OTHER" })]);
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out).toMatchObject({ ok: false, reason: "invalid_next_message" });
  });

  it("phase 取得不能（null）: fetch_failed", async () => {
    const a = adapter(null);
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out).toMatchObject({ ok: false, reason: "fetch_failed" });
  });

  it("next が response（送信対象外）: no_sendable・push しない", async () => {
    const a = adapter([mk({ id: "m2", kind: "response" })]);
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out).toMatchObject({ ok: false, reason: "no_sendable" });
    expect(a.pushChain).not.toHaveBeenCalled();
  });

  it("push 失敗: resumeFailed・再arm しない（二重 push なし）", async () => {
    const a = adapter([mk({ id: "m2" })], { pushOk: false });
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out).toMatchObject({ ok: false, reason: "push_failed" });
    expect(a.rearm).not.toHaveBeenCalled();
  });

  it("再arm が例外: 後続送信は成功済みなので ok のまま（rearmed=0）", async () => {
    const a = adapter([mk({ id: "m2" })], { rearmThrows: true });
    const out = await a.chain({ row: ROW, nextMessageId: "m2", now: NOW });
    expect(out.ok).toBe(true); expect(out.rearmed).toBe(0);
  });
});
