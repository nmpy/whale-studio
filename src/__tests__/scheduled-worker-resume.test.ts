/**
 * src/__tests__/scheduled-worker-resume.test.ts
 *
 * PR-SER3 worker orchestration: 予約 push 成功 → markSent → (flag ON かつ resumeChain 注入時のみ) resume を1回。
 * idempotency: markSent 後にだけ resume / push失敗・markSent失敗・dryRun では resume しない / flag OFF は resumeSkipped。
 * 実 push / チェーン取得 / 再arm は resumeChain を mock してここでは呼び出し挙動と counters のみ検証。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runScheduledMessageWorker,
  type ScheduledWorkerDb, type PendingScheduledRow, type ResumeChain, type ScheduledSender,
} from "@/lib/scheduled-message-worker";

const NOW = new Date("2026-06-26T00:00:00.000Z");
const RESUME_PAYLOAD = JSON.stringify({ message_type: "text", body: "x", resume: { next_message_id: "m2" } });
const PLAIN_PAYLOAD = JSON.stringify({ message_type: "text", body: "x" });

const order: string[] = [];
function fakeDb(payloadJson: string, markSentThrows = false): ScheduledWorkerDb {
  const row: PendingScheduledRow = {
    id: "r1", workId: "w1", lineUserId: "U1", userProgressId: "up1", phaseId: "p1",
    cancelPolicyJson: null, oaId: "oa1", sourceMessageId: "src1", payloadJson, retryCount: 0,
  };
  return {
    findDuePending: async () => [row],
    claimToSending: async () => 1,
    markCanceled: async () => {},
    markSent: async () => { if (markSentThrows) throw new Error("db"); order.push("markSent"); },
    markFailed: async () => {},
    markRetry: async () => {},
    findStuckSending: async () => [],
  };
}
const sentSender: ScheduledSender = async () => ({ sent: true, requestId: "req1" });
const failSender: ScheduledSender = async () => ({ sent: false, error: "line_5xx", retryable: true });

const run = (db: ScheduledWorkerDb, opts: { resumeChain?: ResumeChain; sender?: ScheduledSender; dryRun?: boolean }) =>
  runScheduledMessageWorker({
    db, getUserProgress: async () => ({ currentPhaseId: "p1", reachedEnding: false }),
    now: NOW, sender: opts.sender ?? sentSender, resumeChain: opts.resumeChain, dryRun: opts.dryRun,
  });

describe("worker resume orchestration (PR-SER3)", () => {
  beforeEach(() => { order.length = 0; });
  afterEach(() => { delete process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION; });

  it("resume cursor なし: push→sent のみ・resumeChain 呼ばれない", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: true }));
    const r = await run(fakeDb(PLAIN_PAYLOAD), { resumeChain });
    expect(r.sent).toBe(1);
    expect(resumeChain).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0); expect(r.resumeSkipped).toBe(0); expect(r.resumeFailed).toBe(0);
  });

  it("resume cursor あり + flag OFF: sent するが resumeSkipped（resume しない）", async () => {
    delete process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION;
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: true }));
    const r = await run(fakeDb(RESUME_PAYLOAD), { resumeChain });
    expect(r.sent).toBe(1);
    expect(resumeChain).not.toHaveBeenCalled();
    expect(r.resumeSkipped).toBe(1); expect(r.resumed).toBe(0);
  });

  it("resume cursor あり + flag ON + アダプタ注入: markSent の後に resumeChain を1回", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => { order.push("resume"); return { ok: true, sentCount: 1 }; });
    const r = await run(fakeDb(RESUME_PAYLOAD), { resumeChain });
    expect(resumeChain).toHaveBeenCalledTimes(1);
    expect(resumeChain.mock.calls[0][0]).toMatchObject({ nextMessageId: "m2", now: NOW });
    expect(order).toEqual(["markSent", "resume"]);   // 順序: markSent → resume
    expect(r.resumed).toBe(1); expect(r.resumeFailed).toBe(0);
  });

  it("flag ON だが resumeChain 未注入: resumeSkipped", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const r = await run(fakeDb(RESUME_PAYLOAD), {});
    expect(r.sent).toBe(1); expect(r.resumeSkipped).toBe(1); expect(r.resumed).toBe(0);
  });

  it("push 失敗: markSent も resume もしない", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: true }));
    const r = await run(fakeDb(RESUME_PAYLOAD), { resumeChain, sender: failSender });
    expect(r.sent).toBe(0);
    expect(order).not.toContain("markSent");
    expect(resumeChain).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0); expect(r.resumeFailed).toBe(0);
  });

  it("markSent 失敗: resume しない（errors 計上・二重 push なし）", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: true }));
    const r = await run(fakeDb(RESUME_PAYLOAD, /*markSentThrows*/ true), { resumeChain });
    expect(resumeChain).not.toHaveBeenCalled();
    expect(r.errors).toBe(1); expect(r.resumed).toBe(0);
  });

  it("resumeChain が ok:false: resumeFailed を計上（予約は sent のまま・二重 push なし）", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: false, reason: "push_failed" }));
    const r = await run(fakeDb(RESUME_PAYLOAD), { resumeChain });
    expect(r.sent).toBe(1); expect(r.resumeFailed).toBe(1); expect(r.resumed).toBe(0);
  });

  it("resumeChain が例外: resumeFailed を計上・worker は落ちない", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => { throw new Error("boom"); });
    const r = await run(fakeDb(RESUME_PAYLOAD), { resumeChain });
    expect(r.sent).toBe(1); expect(r.resumeFailed).toBe(1); expect(r.errors).toBe(0);
  });

  it("dryRun: claim/markSent しないので resume も走らない", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: true }));
    const r = await run(fakeDb(RESUME_PAYLOAD), { resumeChain, dryRun: true });
    expect(r.dryRun).toBe(true); expect(r.sent).toBe(0);
    expect(resumeChain).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0); expect(r.resumeSkipped).toBe(0);
  });

  it("二重起動相当: sent 済みは findDuePending が返さない＝resume も1回きり（同一予約で再 resume されない）", async () => {
    process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION = "true";
    const resumeChain = vi.fn<ResumeChain>(async () => ({ ok: true }));
    // 2回目の起動を模した db: pending が無い（= sent 済みで拾われない）。
    const emptyDb: ScheduledWorkerDb = { ...fakeDb(RESUME_PAYLOAD), findDuePending: async () => [] };
    const r = await run(emptyDb, { resumeChain });
    expect(resumeChain).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});
