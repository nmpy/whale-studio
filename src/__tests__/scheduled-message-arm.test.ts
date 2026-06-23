/**
 * src/__tests__/scheduled-message-arm.test.ts
 * 時間差メッセージの「予約作成」runtime 接続（PR-4c-2）。
 * flag ゲート・enabled/valid のみ作成・冪等・cancelPolicy/payload 生成・PII/push なしを検証。prisma はモック。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { store, createMock, findUniqueMock, findManyMock } = vi.hoisted(() => {
  const store = new Map<string, { id: string; status: string }>();
  const createMock = vi.fn(async ({ data }: { data: { idempotencyKey: string; status: string } }) => {
    const row = { id: `res-${store.size + 1}`, status: data.status };
    store.set(data.idempotencyKey, row);
    return row;
  });
  const findUniqueMock = vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => store.get(where.idempotencyKey) ?? null);
  const findManyMock = vi.fn(async () => [] as unknown[]);
  return { store, createMock, findUniqueMock, findManyMock };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message:               { findMany: findManyMock },
    scheduledLineMessage:  { findUnique: findUniqueMock, create: createMock },
  },
}));

import { armScheduledMessages } from "@/lib/scheduled-message-arm";

type CreateArg = { data: { status: string; payloadJson: string; cancelPolicyJson: string; sourceMessageId: string } };

const NOW = new Date("2026-06-23T09:00:00.000Z");
const ENABLED_SETTINGS = { enabled: true, delay_minutes: 10, body: "あとで送るよ", character_id: null, cancel_on_phase_change: true, cancel_on_work_completed: false };

const msgRow = (over: Record<string, unknown> = {}) => ({
  id: "m1", phaseId: "p1", scheduledMessageSettings: JSON.stringify(ENABLED_SETTINGS), ...over,
});

const baseArgs = (over: Record<string, unknown> = {}) => ({
  sentMessageIds: ["m1"], oaId: "oa1", workId: "w1", lineUserId: "U1", userProgressId: "up1", now: NOW, ...over,
});

describe("armScheduledMessages", () => {
  beforeEach(() => {
    store.clear(); vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    process.env.ENABLE_SCHEDULED_MESSAGE_RESERVATION = "true";
  });
  afterEach(() => { delete process.env.ENABLE_SCHEDULED_MESSAGE_RESERVATION; });

  it("flag 未設定では予約作成されない（findMany も叩かない）", async () => {
    delete process.env.ENABLE_SCHEDULED_MESSAGE_RESERVATION;
    findManyMock.mockResolvedValue([msgRow()]);
    const r = await armScheduledMessages(baseArgs());
    expect(r).toEqual({ created: 0, skipped: 0, failed: 0 });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("flag 有効 + enabled + valid → pending 予約が1件作成される", async () => {
    findManyMock.mockResolvedValue([msgRow()]);
    const r = await armScheduledMessages(baseArgs());
    expect(r.created).toBe(1);
    expect(createMock).toHaveBeenCalledOnce();
    const data = (createMock.mock.calls[0][0] as unknown as CreateArg).data;
    expect(data.status).toBe("pending");
    expect(data.sourceMessageId).toBe("m1");
  });

  it("payloadJson は text + body + characterId、token/lineUserId を含まない", async () => {
    findManyMock.mockResolvedValue([msgRow({ scheduledMessageSettings: JSON.stringify({ ...ENABLED_SETTINGS, character_id: "0123abcd-4567-89ef-0123-456789abcdef" }) })]);
    await armScheduledMessages(baseArgs());
    const data = (createMock.mock.calls[0][0] as unknown as CreateArg).data;
    const payload = JSON.parse(data.payloadJson);
    expect(payload).toEqual({ message_type: "text", body: "あとで送るよ", character_id: "0123abcd-4567-89ef-0123-456789abcdef" });
    expect(JSON.stringify(payload)).not.toContain("U1"); // lineUserId なし
  });

  it("cancelPolicyJson に phase_changed / work_completed が反映される", async () => {
    findManyMock.mockResolvedValue([msgRow({ scheduledMessageSettings: JSON.stringify({ ...ENABLED_SETTINGS, cancel_on_phase_change: true, cancel_on_work_completed: true }) })]);
    await armScheduledMessages(baseArgs());
    const data = (createMock.mock.calls[0][0] as unknown as CreateArg).data;
    const policy = JSON.parse(data.cancelPolicyJson);
    expect(policy.phaseChanged).toEqual({ fromPhaseId: "p1" });
    expect(policy.workCompleted).toBe(true);
  });

  it("enabled=false / body空 / 不正JSON は作成しない（skip）", async () => {
    findManyMock.mockResolvedValue([
      msgRow({ id: "a", scheduledMessageSettings: JSON.stringify({ ...ENABLED_SETTINGS, enabled: false }) }),
      msgRow({ id: "b", scheduledMessageSettings: JSON.stringify({ ...ENABLED_SETTINGS, body: "  " }) }),
      msgRow({ id: "c", scheduledMessageSettings: "{壊れ" }),
    ]);
    const r = await armScheduledMessages(baseArgs({ sentMessageIds: ["a", "b", "c"] }));
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(3);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("送信なし / 設定を持つ送信が無ければ no-op", async () => {
    findManyMock.mockResolvedValue([]);
    expect(await armScheduledMessages(baseArgs({ sentMessageIds: [] }))).toEqual({ created: 0, skipped: 0, failed: 0 });
    expect(await armScheduledMessages(baseArgs())).toEqual({ created: 0, skipped: 0, failed: 0 });
  });

  it("同一条件の二重呼び出しでは二重予約されない（冪等）", async () => {
    findManyMock.mockResolvedValue([msgRow()]);
    const r1 = await armScheduledMessages(baseArgs());
    const r2 = await armScheduledMessages(baseArgs()); // 同 user/source/分 → 同キー
    expect(r1.created).toBe(1);
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(store.size).toBe(1);
  });

  it("別ユーザー操作は別予約になる", async () => {
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ lineUserId: "U1" }));
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ lineUserId: "U2" }));
    expect(store.size).toBe(2);
  });

  it("dedup ウィンドウ: 同ユーザー×同source を『同じ分』に2回 → 1件に束ねる（意図的）", async () => {
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ now: new Date("2026-06-23T09:00:05.000Z") }));
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ now: new Date("2026-06-23T09:00:55.000Z") })); // 同分内
    expect(store.size).toBe(1);
  });

  it("dedup ウィンドウ: 同ユーザー×同source でも『別の分』なら別予約", async () => {
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ now: new Date("2026-06-23T09:00:30.000Z") }));
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ now: new Date("2026-06-23T09:02:30.000Z") })); // 2分後 → dueAt も別分
    expect(store.size).toBe(2);
  });

  it("複数 messageId をまとめて findMany し、enabled な複数 source を別々に予約", async () => {
    findManyMock.mockResolvedValue([
      msgRow({ id: "m1" }),
      msgRow({ id: "m2" }),
    ]);
    const r = await armScheduledMessages(baseArgs({ sentMessageIds: ["m1", "m2"] }));
    expect(findManyMock).toHaveBeenCalledOnce(); // N+1 でなく一括取得
    expect((findManyMock.mock.calls[0] as unknown as [{ where: { id: unknown } }])[0].where.id).toEqual({ in: ["m1", "m2"] });
    expect(r.created).toBe(2);
    expect(store.size).toBe(2);
  });

  it("findMany は workId スコープ付き（cross-work 防御）", async () => {
    findManyMock.mockResolvedValue([msgRow()]);
    await armScheduledMessages(baseArgs({ workId: "w-scope" }));
    expect((findManyMock.mock.calls[0] as unknown as [{ where: { workId: string } }])[0].where.workId).toBe("w-scope");
  });

  it("予約作成で例外が出ても全体は落ちない（failed 計上・他は継続）", async () => {
    findManyMock.mockResolvedValue([msgRow({ id: "x" }), msgRow({ id: "y" })]);
    createMock.mockRejectedValueOnce(new Error("db down")); // 1件目だけ失敗
    const r = await armScheduledMessages(baseArgs({ sentMessageIds: ["x", "y"] }));
    expect(r.failed).toBe(1);
    expect(r.created).toBe(1);
  });
});
