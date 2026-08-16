// src/__tests__/broadcast-cron-worker.test.ts
//
// 配信メッセージの server-side cron worker。
// 「ブラウザを開き続けること」を配信完了条件にしない構造になっていることを固定する。
// 既存の安全設計（recipient CAS / retry key / 409 / retry 分類 / 集計）は
// processBroadcastChunk 側に閉じているので、ここでは worker の責務だけを検証する。

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runBroadcastWorker,
  WORKER_MAX_BROADCASTS,
  WORKER_TIME_BUDGET_MS,
  WORKER_FIRST_CHUNK_ESTIMATE_MS,
} from "@/lib/broadcast/worker";
import { BROADCAST_CHUNK_SIZE } from "@/lib/broadcast/processor";
import type { ProcessResult } from "@/lib/broadcast/processor";

const okResult = (o: Partial<Extract<ProcessResult, { ok: true }>> = {}): ProcessResult => ({
  ok: true, processed: 0, sent: 0, failed: 0, skipped: 0, hasMore: false, status: "sent", ...o,
});

/** 指定件数の宛先を chunk 単位で処理する擬似 processChunk。LINE 送信は行わない。 */
function makeFakeChunkProcessor(state: { pending: number }, chunk = BROADCAST_CHUNK_SIZE) {
  return vi.fn(async (): Promise<ProcessResult> => {
    const n = Math.min(chunk, state.pending);
    state.pending -= n;
    return okResult({
      processed: n, sent: n, failed: 0, skipped: 0,
      hasMore: state.pending > 0,
      status: state.pending > 0 ? "sending" : "sent",
    });
  });
}

let clock = 0;
const now = () => clock;
beforeEach(() => { clock = 0; });

// ══════════════════════════════════════════════════════════════════
describe("B. worker の対象選択", () => {
  it("status=sending の Broadcast だけを取りに行く（draft を勝手に送らない）", async () => {
    const list = vi.fn().mockResolvedValue([]);
    await runBroadcastWorker({ listSendingBroadcasts: list, processChunk: vi.fn(), now }, { dryRun: false });
    // 取得件数の上限だけを渡し、status 条件は呼び出し側(route)の where で "sending" に固定する
    expect(list).toHaveBeenCalledWith(WORKER_MAX_BROADCASTS);
  });

  it("対象が無ければ 1 chunk も処理しない", async () => {
    const proc = vi.fn();
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [], processChunk: proc, now }, { dryRun: false });
    expect(proc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ selected: 0, chunks: 0, processed: 0 });
  });

  it("processChunk が not_sending を返す Broadcast はスキップする（sent / draft の保険）", async () => {
    const proc = vi.fn().mockResolvedValue({ ok: false, reason: "not_sending" } as ProcessResult);
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false });
    expect(proc).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ chunks: 0, processed: 0, sent: 0 });
  });

  it("dryRun では 1 通も送らず DB も触らない（env 未設定時の安全側）", async () => {
    const proc = vi.fn();
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: true });
    expect(proc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ dryRun: true, selected: 1, chunks: 0, remainingBroadcasts: 1 });
  });
});

// ══════════════════════════════════════════════════════════════════
describe("C/D. ブラウザ非依存で完了まで到達する", () => {
  it("client の process loop が無くても worker だけで sent まで到達する", async () => {
    const state = { pending: 120 }; // 50 + 50 + 20
    const proc = makeFakeChunkProcessor(state);
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false, timeBudgetMs: 10_000_000 });

    expect(proc).toHaveBeenCalledTimes(3);
    expect(state.pending).toBe(0);
    expect(r).toMatchObject({ chunks: 3, processed: 120, sent: 120, touched: 1, budgetExhausted: false });
  });

  it("chunk size は既存の 50 のまま", () => {
    expect(BROADCAST_CHUNK_SIZE).toBe(50);
  });

  it("複数 Broadcast を 1 invocation で順に進められる", async () => {
    const s1 = { pending: 30 }, s2 = { pending: 20 };
    const p1 = makeFakeChunkProcessor(s1), p2 = makeFakeChunkProcessor(s2);
    const proc = vi.fn(async (a: { broadcastId: string }) => (a.broadcastId === "b1" ? p1() : p2()));
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }, { id: "b2", oaId: "oa2" }], processChunk: proc, now },
      { dryRun: false, timeBudgetMs: 10_000_000 });
    expect(r).toMatchObject({ selected: 2, touched: 2, processed: 50, sent: 50 });
  });
});

// ══════════════════════════════════════════════════════════════════
describe("E. 大規模 audience を複数 invocation にまたいで完了させる", () => {
  it("3000 件を wall-clock 予算内の chunk に区切り、次回 invocation へ引き継いで完了する", async () => {
    const state = { pending: 3000 };
    // 1 chunk = 5 秒かかる想定にして予算超過を再現する
    const proc = vi.fn(async (): Promise<ProcessResult> => {
      clock += 5_000;
      const n = Math.min(BROADCAST_CHUNK_SIZE, state.pending);
      state.pending -= n;
      return okResult({ processed: n, sent: n, hasMore: state.pending > 0, status: state.pending > 0 ? "sending" : "sent" });
    });

    let invocations = 0, totalSent = 0;
    while (state.pending > 0) {
      clock = 0; // 次の cron invocation（予算はリセットされる）
      const r = await runBroadcastWorker(
        { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
        { dryRun: false, timeBudgetMs: WORKER_TIME_BUDGET_MS });
      totalSent += r.sent;
      invocations++;
      expect(r.elapsedMs).toBeLessThanOrEqual(WORKER_TIME_BUDGET_MS);
      if (invocations > 200) break; // 無限ループ保険
    }
    expect(state.pending).toBe(0);
    expect(totalSent).toBe(3000);
    expect(invocations).toBeGreaterThan(1); // 1 invocation で全部やろうとしていない
  });

  it("予算を超えそうなら次の chunk を始めない", async () => {
    const state = { pending: 500 };
    const proc = vi.fn(async (): Promise<ProcessResult> => {
      clock += 20_000; // 1 chunk 20 秒
      const n = Math.min(BROADCAST_CHUNK_SIZE, state.pending);
      state.pending -= n;
      return okResult({ processed: n, sent: n, hasMore: state.pending > 0, status: "sending" });
    });
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false, timeBudgetMs: WORKER_TIME_BUDGET_MS });

    // 20s×1.5=30s を予算 45s から引くと 2 回目の開始が限界。3 回目は始めない
    expect(r.chunks).toBeLessThanOrEqual(2);
    expect(r.budgetExhausted).toBe(true);
    expect(r.elapsedMs).toBeLessThanOrEqual(WORKER_TIME_BUDGET_MS);
  });

  it("初回 chunk の見積もりが予算を超える設定では 1 chunk も始めない", async () => {
    const proc = vi.fn();
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false, timeBudgetMs: WORKER_FIRST_CHUNK_ESTIMATE_MS }); // 予算 = 見積もりそのもの
    expect(proc).not.toHaveBeenCalled();
    expect(r.budgetExhausted).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("F. 並行 worker", () => {
  it("CAS に全部負けた（他 worker が処理中）なら空回りせず次回へ回す", async () => {
    const proc = vi.fn().mockResolvedValue(
      okResult({ processed: 0, sent: 0, skipped: 0, hasMore: true, status: "sending" }));
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false, timeBudgetMs: 10_000_000 });

    expect(proc).toHaveBeenCalledTimes(1); // 無限ループしない
    expect(r).toMatchObject({ remainingBroadcasts: 1, touched: 0 });
  });

  it("CAS に一部負けた場合は casLost として数え、押し込めた分だけ進む", async () => {
    const state = { pending: 100 };
    const proc = vi.fn(async (): Promise<ProcessResult> => {
      const n = Math.min(BROADCAST_CHUNK_SIZE, state.pending);
      state.pending -= n;
      // 50 件のうち 10 件は他 worker が先に claim した想定
      return okResult({ processed: n - 10, sent: n - 10, skipped: 10, hasMore: state.pending > 0,
                        status: state.pending > 0 ? "sending" : "sent" });
    });
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false, timeBudgetMs: 10_000_000 });
    expect(r).toMatchObject({ casLost: 20, sent: 80, chunks: 2 });
  });

  it("worker は Broadcast 単位の lock を持たない（重複防止は recipient CAS に委ねる）", async () => {
    // 同じ Broadcast を 2 worker が同時に処理しても、processChunk 内の CAS が
    // 同一 recipient への push を 1 回に抑える。worker 側は排他しない。
    const claimed = new Set<number>();
    let pending = 10;
    const proc = vi.fn(async (): Promise<ProcessResult> => {
      let sent = 0, lost = 0;
      for (let i = 0; i < 10 && pending > 0; i++) {
        if (claimed.has(i)) { lost++; continue; }  // CAS 敗北
        claimed.add(i); sent++; pending--;         // CAS 勝利 → push 1 回
      }
      return okResult({ processed: sent, sent, skipped: lost, hasMore: pending > 0,
                        status: pending > 0 ? "sending" : "sent" });
    });
    const deps = { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now };
    const [a, b] = await Promise.all([
      runBroadcastWorker(deps, { dryRun: false, timeBudgetMs: 10_000_000 }),
      runBroadcastWorker(deps, { dryRun: false, timeBudgetMs: 10_000_000 }),
    ]);
    // 宛先 10 件に対して push は合計 10 回だけ（二重送信ゼロ）
    expect(a.sent + b.sent).toBe(10);
    expect(claimed.size).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("N. 完了確定は既存ロジックに委ねる", () => {
  it("worker は集計・status 確定を自前で行わない（processChunk の結果をそのまま使う）", async () => {
    const proc = vi.fn().mockResolvedValue(
      okResult({ processed: 3, sent: 2, failed: 1, hasMore: false, status: "partial_failed" }));
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: proc, now },
      { dryRun: false });
    // worker の戻り値は「今回の invocation で何をしたか」だけ。Broadcast の最終 status は
    // processChunk（= 既存 finalization）が DB に書く。
    expect(r).toMatchObject({ chunks: 1, processed: 3, sent: 2, failed: 1 });
    expect(Object.keys(r)).not.toContain("status");
  });
});

// ══════════════════════════════════════════════════════════════════
describe("Phase 8. 観測用の戻り値", () => {
  it("件数系のフィールドを揃えて返す（本文・宛先 ID は含めない）", async () => {
    const state = { pending: 60 };
    const r = await runBroadcastWorker(
      { listSendingBroadcasts: async () => [{ id: "b1", oaId: "oa1" }], processChunk: makeFakeChunkProcessor(state), now },
      { dryRun: false, timeBudgetMs: 10_000_000 });
    for (const k of ["selected","touched","chunks","processed","sent","failed","casLost","remainingBroadcasts","budgetExhausted","elapsedMs","dryRun"]) {
      expect(r).toHaveProperty(k);
    }
    // PII / 本文が混ざらないこと
    expect(JSON.stringify(r)).not.toMatch(/U[0-9a-f]{32}/i);
  });
});
