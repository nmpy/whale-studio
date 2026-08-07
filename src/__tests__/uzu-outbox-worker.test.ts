// UZU 連携 outbox worker の挙動（claim / 送信 / 再送 / 滞留回復 / dryRun）。
// DB は in-memory の fake で置き換え、実 DB へは接続しない。

import { describe, expect, it, vi } from "vitest";
import { runUzuOutboxWorker } from "@/lib/uzu-outbox-worker";
import { OUTBOX_STATUS, STUCK_SENDING_MS } from "@/lib/uzu-outbox";

const NOW = new Date("2026-08-07T00:00:00.000Z");

type Row = {
  id: string; oaId: string; workId: string; uzuProjectId: string; eventType: string;
  payloadJson: unknown; attempt: number; status: string; nextAttemptAt: Date;
  claimedAt: Date | null; sentAt: Date | null; lastErrorCode: string | null; lastError: string | null;
};

function makeRow(over: Partial<Row> = {}): Row {
  return {
    id: "r1", oaId: "oa1", workId: "w1", uzuProjectId: "p1", eventType: "player_line.linked",
    payloadJson: { reservationNumber: "ESC-1", lineUserId: "U1" }, attempt: 0,
    status: OUTBOX_STATUS.pending, nextAttemptAt: new Date(NOW.getTime() - 1000),
    claimedAt: null, sentAt: null, lastErrorCode: null, lastError: null, ...over,
  };
}

/** prisma の必要メソッドだけを持つ最小 fake。 */
function fakeDb(rows: Row[]) {
  const match = (r: Row, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      const cur = (r as unknown as Record<string, unknown>)[k];
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const cond = v as Record<string, unknown>;
        if ("lte" in cond && !(cur instanceof Date && cur.getTime() <= (cond.lte as Date).getTime())) return false;
        if ("lt" in cond && !(cur instanceof Date && cur.getTime() < (cond.lt as Date).getTime())) return false;
      } else if (cur !== v) return false;
    }
    return true;
  };
  return {
    rows,
    uzuOutboxEvent: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)).length),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        rows.filter((r) => match(r, where)).slice(0, take ?? rows.length).map((r) => ({ ...r })),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => match(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      }),
    },
  };
}

const base = { now: NOW, baseUrl: "https://uzu.example", secret: "s" };

describe("runUzuOutboxWorker", () => {
  it("dryRun は DB を変更せず件数だけ数える", async () => {
    const rows = [makeRow(), makeRow({ id: "r2" })];
    const db = fakeDb(rows);
    const fetcher = vi.fn();
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: true, fetcher });
    expect(r.dryRun).toBe(true);
    expect(r.claimed).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(rows.every((x) => x.status === OUTBOX_STATUS.pending)).toBe(true);
  });

  it("送信成功で sent になる", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.sent).toBe(1);
    expect(rows[0].status).toBe(OUTBOX_STATUS.sent);
    expect(rows[0].sentAt).toEqual(NOW);
  });

  it("UZU が 200 を返せば（内部が BOOKING_NOT_IMPORTED でも）配送は成功扱い", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    // UZU は保留時も 200 を返す契約
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.sent).toBe(1);
    expect(r.retried).toBe(0);
    expect(rows[0].status).toBe(OUTBOX_STATUS.sent);
  });

  it("5xx は retry（pending へ戻り attempt が増える）", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.retried).toBe(1);
    expect(rows[0].status).toBe(OUTBOX_STATUS.pending);
    expect(rows[0].attempt).toBe(1);
    expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(rows[0].lastErrorCode).toBe("HTTP_503");
  });

  it("400 は即 failed（再送しない）", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.failed).toBe(1);
    expect(rows[0].status).toBe(OUTBOX_STATUS.failed);
    expect(rows[0].lastErrorCode).toBe("INVALID_PAYLOAD");
  });

  it("401 は即 failed（設定不備として識別できる）", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.failed).toBe(1);
    expect(rows[0].lastErrorCode).toBe("UNAUTHORIZED");
  });

  it("再送上限に達したら failed へ落ちる", async () => {
    const rows = [makeRow({ attempt: 4 })]; // 次の失敗で 5 回目 = 上限
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.failed).toBe(1);
    expect(rows[0].status).toBe(OUTBOX_STATUS.failed);
  });

  it("sending のまま滞留した行を pending へ戻す", async () => {
    const stuck = makeRow({ id: "stuck", status: OUTBOX_STATUS.sending, claimedAt: new Date(NOW.getTime() - STUCK_SENDING_MS - 1000) });
    const db = fakeDb([stuck]);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.recovered).toBe(1);
    // 回復後に同一 run で claim され送信される
    expect(r.sent).toBe(1);
  });

  it("nextAttemptAt が未来の行は claim しない", async () => {
    const rows = [makeRow({ nextAttemptAt: new Date(NOW.getTime() + 60_000) })];
    const db = fakeDb(rows);
    const fetcher = vi.fn();
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    expect(r.claimed).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("送信先未設定なら DB を変更しない", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const fetcher = vi.fn();
    const r = await runUzuOutboxWorker(db as never, { now: NOW, dryRun: false, baseUrl: null, secret: null, fetcher });
    expect(r.skipped).toBe(1);
    expect(rows[0].status).toBe(OUTBOX_STATUS.pending);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("batchSize を超える件数は次回に回す", async () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" }), makeRow({ id: "c" })];
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher, batchSize: 2 });
    expect(r.claimed).toBe(2);
    expect(rows.filter((x) => x.status === OUTBOX_STATUS.pending)).toHaveLength(1);
  });

  it("eventId（行 id）は再送しても変わらない", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher });
    rows[0].nextAttemptAt = new Date(NOW.getTime() - 1000); // 再送時刻が来たとみなす
    const fetcher2 = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await runUzuOutboxWorker(db as never, { ...base, dryRun: false, fetcher: fetcher2 });
    const body1 = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string);
    const body2 = JSON.parse((fetcher2.mock.calls[0][1] as RequestInit).body as string);
    expect(body1.eventId).toBe(body2.eventId);
    expect(body1.eventId).toBe("r1");
  });
});
