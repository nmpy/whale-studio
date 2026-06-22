/**
 * src/__tests__/scheduled-message-worker.test.ts
 * 時間差メッセージ worker（PR-4a）: dueAt 抽出・atomic claim・キャンセル判定・状態遷移。
 * 実 LINE push は行わない（no-op sender）。DB/userProgress/sender/now は注入してテスト。
 */
import { describe, it, expect, vi } from "vitest";
import {
  runScheduledMessageWorker, noopSender, DEFAULT_BATCH_SIZE,
  type PendingScheduledRow, type ScheduledWorkerDb, type UserProgressState, type ScheduledSender,
} from "@/lib/scheduled-message-worker";
import { buildCancelPolicy } from "@/lib/scheduled-message";

const NOW = new Date("2026-06-23T12:00:00.000Z");

interface Row extends PendingScheduledRow { status: string; dueAt: Date; canceledReason?: string; sentRequestId?: string | null; }

function makeRow(over: Partial<Row> = {}): Row {
  return {
    id: over.id ?? "r1", workId: "w1", lineUserId: "U1",
    userProgressId: "up1", phaseId: "p1",
    cancelPolicyJson: null, status: "pending",
    dueAt: new Date(NOW.getTime() - 60_000), // 既定: 期限到来済み
    ...over,
  };
}

/** in-memory DB（claim は status=pending のときだけ成功 = atomic 相当）。 */
function fakeDb(rows: Row[]): ScheduledWorkerDb & { rows: Row[] } {
  return {
    rows,
    async findDuePending({ now, limit }) {
      return rows
        .filter((r) => r.status === "pending" && r.dueAt.getTime() <= now.getTime())
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        .slice(0, limit)
        .map(({ id, workId, lineUserId, userProgressId, phaseId, cancelPolicyJson }) =>
          ({ id, workId, lineUserId, userProgressId, phaseId, cancelPolicyJson }));
    },
    async claimToSending(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== "pending") return 0; // 既に他が claim 済み等 → 0
      r.status = "sending";
      return 1;
    },
    async markCanceled(id, reason) {
      const r = rows.find((x) => x.id === id)!; r.status = "canceled"; r.canceledReason = reason;
    },
    async markSent(id, requestId) {
      const r = rows.find((x) => x.id === id)!; r.status = "sent"; r.sentRequestId = requestId;
    },
  };
}

const progressOK: (row: PendingScheduledRow) => Promise<UserProgressState | null> =
  async () => ({ currentPhaseId: "p1", reachedEnding: false });

describe("runScheduledMessageWorker — 抽出 / claim / 件数上限", () => {
  it("dueAt > now の pending は拾わない（dueAt<=now だけ）", async () => {
    const rows = [
      makeRow({ id: "past", dueAt: new Date(NOW.getTime() - 1000) }),
      makeRow({ id: "future", dueAt: new Date(NOW.getTime() + 600_000) }),
    ];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW });
    expect(res.claimed).toBe(1);
    expect(rows.find((r) => r.id === "future")!.status).toBe("pending"); // 未来は手つかず
    expect(rows.find((r) => r.id === "past")!.status).toBe("sending");
  });

  it("batchSize で件数制限される", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({ id: `r${i}` }));
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW, batchSize: 2 });
    expect(res.claimed).toBe(2);
    expect(rows.filter((r) => r.status === "sending").length).toBe(2);
  });

  it("既定 batchSize は 20", () => { expect(DEFAULT_BATCH_SIZE).toBe(20); });

  it("pending→sending の claim が成功し claimed として計上（no-op sender なので sent にしない）", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW });
    expect(res).toMatchObject({ claimed: 1, canceled: 0, skipped: 0, sent: 0, errors: 0 });
    expect(rows[0].status).toBe("sending");
  });

  it("既に sending/sent/canceled/failed は拾われない・claim されない", async () => {
    const rows = [
      makeRow({ id: "a", status: "sending" }),
      makeRow({ id: "b", status: "sent" }),
      makeRow({ id: "c", status: "canceled" }),
      makeRow({ id: "d", status: "failed" }),
    ];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW });
    expect(res).toMatchObject({ claimed: 0, canceled: 0, skipped: 0, sent: 0 });
  });

  it("同時実行相当: claim 済み(0件)は二重 claim せず skipped", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    // 別 worker が先に claim したように claimToSending を 0 で上書き。
    const spied: ScheduledWorkerDb = { ...db, claimToSending: vi.fn(async () => 0) };
    const res = await runScheduledMessageWorker({ db: spied, getUserProgress: progressOK, now: NOW });
    expect(res).toMatchObject({ claimed: 0, skipped: 1 });
  });
});

describe("runScheduledMessageWorker — キャンセル判定", () => {
  it("phase_changed: 予約時 phase と現在 phase が違えば canceled（理由 phase_changed）", async () => {
    const rows = [makeRow({ cancelPolicyJson: JSON.stringify(buildCancelPolicy({ phaseId: "p1", cancelOnPhaseChange: true })) })];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({
      db, now: NOW,
      getUserProgress: async () => ({ currentPhaseId: "p2", reachedEnding: false }), // 進行した
    });
    expect(res).toMatchObject({ canceled: 1, claimed: 0 });
    expect(rows[0]).toMatchObject({ status: "canceled", canceledReason: "phase_changed" });
  });

  it("work_completed: 作品完了なら canceled（理由 work_completed）", async () => {
    const rows = [makeRow({ cancelPolicyJson: JSON.stringify(buildCancelPolicy({ cancelOnWorkComplete: true })) })];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({
      db, now: NOW,
      getUserProgress: async () => ({ currentPhaseId: "p1", reachedEnding: true }),
    });
    expect(res.canceled).toBe(1);
    expect(rows[0].canceledReason).toBe("work_completed");
  });

  it("条件に合致しなければ canceled にせず sending のまま（claimed）", async () => {
    const rows = [makeRow({ cancelPolicyJson: JSON.stringify(buildCancelPolicy({ phaseId: "p1", cancelOnPhaseChange: true })) })];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW });
    expect(res).toMatchObject({ canceled: 0, claimed: 1 });
    expect(rows[0].status).toBe("sending");
  });

  it("userProgress 取得不能（null）時は安全側: canceled/sent にせず sending のまま（claimed）", async () => {
    const rows = [makeRow({ cancelPolicyJson: JSON.stringify(buildCancelPolicy({ phaseId: "p1", cancelOnPhaseChange: true })) })];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: async () => null, now: NOW });
    expect(res).toMatchObject({ canceled: 0, claimed: 1 });
    expect(rows[0].status).toBe("sending");
  });

  it("cancelPolicyJson が壊れていても worker 全体が落ちず処理継続（claimed）", async () => {
    const rows = [makeRow({ cancelPolicyJson: "{壊れたJSON" })];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW });
    expect(res).toMatchObject({ claimed: 1, errors: 0 });
  });
});

describe("runScheduledMessageWorker — sender", () => {
  it("no-op sender では push API（sender 内）が送信扱いにならず sent=0・sending のまま", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW, sender: noopSender });
    expect(res.sent).toBe(0);
    expect(rows[0].status).toBe("sending");
  });

  it("real 相当の sender 注入時のみ sent にできる（PR-4b 設計の確認）", async () => {
    const rows = [makeRow()];
    const db = fakeDb(rows);
    const realish: ScheduledSender = async () => ({ sent: true, requestId: "req-123" });
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW, sender: realish });
    expect(res).toMatchObject({ sent: 1, claimed: 0 });
    expect(rows[0]).toMatchObject({ status: "sent", sentRequestId: "req-123" });
  });

  it("sender が claim されなかった行には呼ばれない（先に skip）", async () => {
    const rows = [makeRow()];
    const db: ScheduledWorkerDb = { ...fakeDb(rows), claimToSending: async () => 0 };
    const sender = vi.fn(async () => ({ sent: false }));
    const res = await runScheduledMessageWorker({ db, getUserProgress: progressOK, now: NOW, sender });
    expect(sender).not.toHaveBeenCalled();
    expect(res.skipped).toBe(1);
  });
});
