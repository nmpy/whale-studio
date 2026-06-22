/**
 * src/__tests__/scheduled-message.test.ts
 * 時間差メッセージ（予約送信）PR-3: dueAt 算出・冪等キー・キャンセル条件・予約作成（重複防止）。
 * 実 push 送信・cron は無し（このPRでは pending 予約の作成までを検証）。
 */
import { describe, it, expect } from "vitest";
import {
  computeScheduledDueAt, buildScheduledMessageIdempotencyKey, buildScheduledLineMessageInput,
  buildCancelPolicy, evaluateCancelPolicy, createScheduledLineMessage,
  shouldCreateScheduledMessage, MAX_DELAY_MINUTES, type ScheduledMessageDb, type BuildScheduledInputArgs,
} from "@/lib/scheduled-message";

const NOW = new Date("2026-06-23T00:00:00.000Z");

const baseArgs = (over: Partial<BuildScheduledInputArgs> = {}): BuildScheduledInputArgs => ({
  oaId: "oa1", workId: "w1", lineUserId: "U123",
  userProgressId: "up1", phaseId: "p1", sourceMessageId: "m1",
  triggerType: "message_action", triggerEventId: "evt1",
  dueAt: computeScheduledDueAt(NOW, 10),
  payload: { message_type: "text", body: "10分後だよ", character_id: "c1" },
  cancelPolicy: buildCancelPolicy({ phaseId: "p1", cancelOnPhaseChange: true, cancelOnWorkComplete: true, dedupeSameTrigger: true }),
  ...over,
});

describe("computeScheduledDueAt", () => {
  it("指定分数後の dueAt を返す（10分後）", () => {
    expect(computeScheduledDueAt(NOW, 10).toISOString()).toBe("2026-06-23T00:10:00.000Z");
  });
  it("30分後 / 1時間後", () => {
    expect(computeScheduledDueAt(NOW, 30).getTime()).toBe(NOW.getTime() + 30 * 60_000);
    expect(computeScheduledDueAt(NOW, 60).getTime()).toBe(NOW.getTime() + 60 * 60_000);
  });
  it("0分 / 負 / NaN / Infinity は拒否（RangeError）", () => {
    expect(() => computeScheduledDueAt(NOW, 0)).toThrow(RangeError);
    expect(() => computeScheduledDueAt(NOW, -5)).toThrow(RangeError);
    expect(() => computeScheduledDueAt(NOW, NaN)).toThrow(RangeError);
    expect(() => computeScheduledDueAt(NOW, Infinity)).toThrow(RangeError);
  });
  it("最大（7日 = 10080分）を超えたら clamp", () => {
    expect(computeScheduledDueAt(NOW, 999999).getTime()).toBe(NOW.getTime() + MAX_DELAY_MINUTES * 60_000);
  });
  it("小数は分単位へ切り上げ", () => {
    expect(computeScheduledDueAt(NOW, 9.2).getTime()).toBe(NOW.getTime() + 10 * 60_000);
  });
});

describe("buildScheduledMessageIdempotencyKey — 安定生成 + 重複束ね", () => {
  it("同一条件なら同じキー（安定）", () => {
    const p = { lineUserId: "U1", workId: "w1", sourceMessageId: "m1", triggerEventId: "e1", dueAt: NOW };
    expect(buildScheduledMessageIdempotencyKey(p)).toBe(buildScheduledMessageIdempotencyKey(p));
  });
  it("同じ dueAt 相当（同一分内）は同じキーに束ねる", () => {
    const a = buildScheduledMessageIdempotencyKey({ lineUserId: "U1", workId: "w1", sourceMessageId: "m1", triggerEventId: "e1", dueAt: new Date("2026-06-23T00:10:05.000Z") });
    const b = buildScheduledMessageIdempotencyKey({ lineUserId: "U1", workId: "w1", sourceMessageId: "m1", triggerEventId: "e1", dueAt: new Date("2026-06-23T00:10:55.000Z") });
    expect(a).toBe(b);
  });
  it("別ユーザー / 別work / 別sourceMessage / 別triggerEvent は別キー", () => {
    const base = { lineUserId: "U1", workId: "w1", sourceMessageId: "m1", triggerEventId: "e1", dueAt: NOW };
    const k = buildScheduledMessageIdempotencyKey(base);
    expect(buildScheduledMessageIdempotencyKey({ ...base, lineUserId: "U2" })).not.toBe(k);
    expect(buildScheduledMessageIdempotencyKey({ ...base, workId: "w2" })).not.toBe(k);
    expect(buildScheduledMessageIdempotencyKey({ ...base, sourceMessageId: "m2" })).not.toBe(k);
    expect(buildScheduledMessageIdempotencyKey({ ...base, triggerEventId: "e2" })).not.toBe(k);
  });
});

describe("buildScheduledLineMessageInput", () => {
  it("status=pending・payload/cancelPolicy を JSON 文字列で保存・idempotencyKey を含む", () => {
    const input = buildScheduledLineMessageInput(baseArgs());
    expect(input.status).toBe("pending");
    expect(JSON.parse(input.payloadJson)).toMatchObject({ message_type: "text", body: "10分後だよ", character_id: "c1" });
    expect(JSON.parse(input.cancelPolicyJson!)).toMatchObject({ phaseChanged: { fromPhaseId: "p1" }, workCompleted: true, sameTrigger: true });
    expect(input.idempotencyKey).toContain("U123:w1:m1:evt1");
  });
});

describe("buildCancelPolicy / evaluateCancelPolicy（送信直前判定・純関数）", () => {
  it("phase_changed: 予約時 phase と現在 phase が違えば cancel", () => {
    const policy = buildCancelPolicy({ phaseId: "p1", cancelOnPhaseChange: true });
    expect(evaluateCancelPolicy(policy, { currentPhaseId: "p1", reachedEnding: false })).toEqual({ cancel: false, reason: null });
    expect(evaluateCancelPolicy(policy, { currentPhaseId: "p2", reachedEnding: false })).toEqual({ cancel: true, reason: "phase_changed" });
  });
  it("work_completed: 作品終了なら cancel", () => {
    const policy = buildCancelPolicy({ cancelOnWorkComplete: true });
    expect(evaluateCancelPolicy(policy, { currentPhaseId: "p1", reachedEnding: true })).toEqual({ cancel: true, reason: "work_completed" });
  });
  it("条件未設定 / 該当なし → cancel:false", () => {
    expect(evaluateCancelPolicy(null, { currentPhaseId: "p1", reachedEnding: true })).toEqual({ cancel: false, reason: null });
    expect(evaluateCancelPolicy({}, { currentPhaseId: "p9", reachedEnding: true })).toEqual({ cancel: false, reason: null });
  });
});

describe("createScheduledLineMessage — pending 作成 + 二重予約防止", () => {
  // in-memory な ScheduledMessageDb（冪等キーで 1 行に束ねる）。
  function fakeDb(): ScheduledMessageDb & { rows: Map<string, { id: string; status: string; key: string }> } {
    const rows = new Map<string, { id: string; status: string; key: string }>();
    let seq = 0;
    return {
      rows,
      async findUnique({ where }) { return rows.get(where.idempotencyKey) ?? null; },
      async create({ data }) {
        if (rows.has(data.idempotencyKey)) { const e = new Error("dup") as Error & { code?: string }; e.code = "P2002"; throw e; }
        const row = { id: `id-${++seq}`, status: data.status, key: data.idempotencyKey };
        rows.set(data.idempotencyKey, row);
        return row;
      },
    };
  }

  it("pending 予約が作成される（created:true）", async () => {
    const db = fakeDb();
    const r = await createScheduledLineMessage(db, baseArgs());
    expect(r.created).toBe(true);
    expect(r.record.status).toBe("pending");
    expect(db.rows.size).toBe(1);
  });

  it("同一条件の二重予約は作成されず既存を返す（created:false）", async () => {
    const db = fakeDb();
    const first  = await createScheduledLineMessage(db, baseArgs());
    const second = await createScheduledLineMessage(db, baseArgs());
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(db.rows.size).toBe(1);
  });

  it("別ユーザー / 別work / 別sourceMessage は別予約になる", async () => {
    const db = fakeDb();
    await createScheduledLineMessage(db, baseArgs());
    await createScheduledLineMessage(db, baseArgs({ lineUserId: "U999" }));
    await createScheduledLineMessage(db, baseArgs({ workId: "w2" }));
    await createScheduledLineMessage(db, baseArgs({ sourceMessageId: "m2" }));
    expect(db.rows.size).toBe(4);
  });

  it("競合（同時 create で unique 衝突 P2002）時も二重予約を作らず既存を返す", async () => {
    const db = fakeDb();
    // 既に同キーの行を入れておく → create が P2002 を投げ、再取得で既存を返す。
    const input = buildScheduledLineMessageInput(baseArgs());
    db.rows.set(input.idempotencyKey, { id: "preexisting", status: "pending", key: input.idempotencyKey });
    const r = await createScheduledLineMessage(db, baseArgs());
    expect(r.created).toBe(false);
    expect(r.record.id).toBe("preexisting");
  });

  it("shouldCreateScheduledMessage: 既存があれば false（status 不問で1件に束ねる）", () => {
    expect(shouldCreateScheduledMessage(null)).toBe(true);
    expect(shouldCreateScheduledMessage({ status: "pending" })).toBe(false);
    expect(shouldCreateScheduledMessage({ status: "canceled" })).toBe(false);
    expect(shouldCreateScheduledMessage({ status: "sent" })).toBe(false);
  });
});
