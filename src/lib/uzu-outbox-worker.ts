// src/lib/uzu-outbox-worker.ts
//
// UZU Pro CMS 送信キューの worker 本体（HTTP ルートから分離してテスト可能にする）。
//
// 流れ:
//   1. recoverStuckSending  … sending のまま滞留した行を pending へ戻す
//   2. claimPending         … pending → sending（排他）
//   3. sendEnvelope         … HTTP POST（transaction 外）
//   4. markSent / markFailure … 結果に応じて確定 or バックオフ
//
// dryRun では DB を一切変更せず、送信対象の件数だけ数える。

import type { PrismaClient } from "@prisma/client";
import { claimPending, markFailure, markSent, recoverStuckSending, OUTBOX_STATUS } from "@/lib/uzu-outbox";
import { buildEnvelope, sendEnvelope, type Fetcher } from "@/lib/uzu-client";

export const DEFAULT_BATCH_SIZE = 20;

export type WorkerResult = {
  dryRun: boolean;
  recovered: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** 送信先 URL 未設定等で処理できなかった件数 */
  skipped: number;
};

const EMPTY = (dryRun: boolean): WorkerResult => ({ dryRun, recovered: 0, claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 });

export async function runUzuOutboxWorker(
  db: PrismaClient,
  opts: {
    now: Date;
    dryRun: boolean;
    baseUrl: string | null;
    secret: string | null;
    batchSize?: number;
    fetcher?: Fetcher;
    timeoutMs?: number;
  },
): Promise<WorkerResult> {
  const result = EMPTY(opts.dryRun);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  if (opts.dryRun) {
    // DB を変更せず、対象件数だけ数える。
    const [duePending, stuck] = await Promise.all([
      db.uzuOutboxEvent.count({ where: { status: OUTBOX_STATUS.pending, nextAttemptAt: { lte: opts.now } } }),
      db.uzuOutboxEvent.count({ where: { status: OUTBOX_STATUS.sending } }),
    ]);
    result.claimed = Math.min(duePending, batchSize);
    result.recovered = stuck;
    return result;
  }

  // 送信先が未設定なら DB を変更しない（誤って failed を量産しない）。
  if (!opts.baseUrl || !opts.secret) {
    result.skipped = await db.uzuOutboxEvent.count({
      where: { status: OUTBOX_STATUS.pending, nextAttemptAt: { lte: opts.now } },
    });
    return result;
  }

  result.recovered = await recoverStuckSending(db, opts.now);

  const rows = await claimPending(db, opts.now, batchSize);
  result.claimed = rows.length;

  for (const row of rows) {
    const envelope = buildEnvelope(row);
    const outcome = await sendEnvelope(envelope, {
      baseUrl:   opts.baseUrl,
      secret:    opts.secret,
      timeoutMs: opts.timeoutMs,
      fetcher:   opts.fetcher,
    });

    if (outcome.ok) {
      // UZU が 200 を返した時点で **配送は成功**。
      // UZU 内部が BOOKING_NOT_IMPORTED として保留していても、それは配送失敗ではない。
      await markSent(db, row.id, opts.now);
      result.sent += 1;
      continue;
    }

    const marked = await markFailure(db, row, {
      retryable: outcome.retryable,
      errorCode: outcome.errorCode,
      message:   outcome.message,
      now:       opts.now,
    });
    if (marked.status === "pending") result.retried += 1;
    else result.failed += 1;
  }

  return result;
}
