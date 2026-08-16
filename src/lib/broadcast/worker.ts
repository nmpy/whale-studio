// src/lib/broadcast/worker.ts
//
// 配信メッセージの server-side worker。**配信専用**。
//
// 目的:
//   「管理画面を開き続けること」を配信完了条件にしない。管理者が「配信する」を 1 回押した
//   時点で recipient snapshot と status=sending は確定しているので、以降の chunk 処理は
//   この worker（cron）が引き継ぐ。ブラウザを閉じても配信は進む。
//
// 設計上の約束:
//   - **送信ロジックは複製しない**。既存の processBroadcastChunk() をそのまま呼ぶ。
//     admin API と cron が同じ関数を共有するため、CAS / retry key / 409 / retry 分類 /
//     集計 / 完了判定はすべて 1 か所のまま。cron 用の別実装は作らない。
//   - cron から admin の HTTP API を叩き直す構造にはしない（認証と責務が二重になるため）。
//   - LINE transport は変更しない（pushToLine のまま。multicast 化しない）。
//     recipient 単位の CAS / status / sentAt / httpStatus / retry key の意味を保つ。
//   - **draft は絶対に処理しない**。管理者が明示的に開始した status="sending" だけが対象。
//     予約配信もここでは実装しない。
//   - in-memory state に依存しない。invocation が落ちても Broadcast / BroadcastRecipient の
//     状態だけで次回 cron から再開できる。
//
// 並行実行の安全性:
//   cron invocation が重なっても、admin 画面の process と同時に走っても、
//   **宛先単位の CAS（pending → sending）が最終防壁**として効くため
//   同一 recipient への LINE Push は 1 回だけになる。
//   そのため Broadcast 単位の lease / lock は追加しない（新しい locking 基盤を持ち込まない）。

import type { ProcessResult } from "./processor";

/** 1 invocation で扱う Broadcast の最大数。 */
export const WORKER_MAX_BROADCASTS = 5;

/**
 * 1 invocation の wall-clock 予算 (ms)。
 * route の maxDuration=60s に対して余裕を持たせる。固定件数だけで区切らず、
 * 「次の chunk を始めたら予算を超えそうなら始めない」方式にする。
 */
export const WORKER_TIME_BUDGET_MS = 45_000;

/**
 * 次 chunk の所要時間見積もりに掛ける安全係数。
 * 直前の chunk の実測 × この係数が残り予算に収まらなければ、その invocation では始めない。
 */
export const WORKER_CHUNK_SAFETY_FACTOR = 1.5;

/** 実測が無い初回 chunk 用の見積もり (ms)。50 通の push を想定した保守的な値。 */
export const WORKER_FIRST_CHUNK_ESTIMATE_MS = 20_000;

export interface BroadcastWorkerDeps {
  /** status="sending" の Broadcast を古い順に取る（draft は絶対に含めない）。 */
  listSendingBroadcasts: (take: number) => Promise<{ id: string; oaId: string }[]>;
  /** 既存の processBroadcastChunk をそのまま渡す。cron 用の別実装は作らない。 */
  processChunk: (args: { oaId: string; broadcastId: string }) => Promise<ProcessResult>;
  /** テストから差し替えるための時刻取得。 */
  now?: () => number;
}

export interface BroadcastWorkerResult {
  /** 選択された Broadcast 件数。 */
  selected: number;
  /** 処理を進めた Broadcast 件数。 */
  touched: number;
  /** 実行した chunk 数。 */
  chunks: number;
  /** 実際に push した宛先数。 */
  processed: number;
  sent: number;
  failed: number;
  /** CAS に負けた宛先数（他 worker / admin が先に claim した）。 */
  casLost: number;
  /** まだ処理が残っている Broadcast 件数（次回 cron が続きを行う）。 */
  remainingBroadcasts: number;
  /** 予算切れで途中終了したか。 */
  budgetExhausted: boolean;
  elapsedMs: number;
  /** dryRun のとき true（1 通も送っていない）。 */
  dryRun: boolean;
}

/**
 * status="sending" の Broadcast を、wall-clock 予算の範囲で進める。
 *
 * dryRun=true のときは対象の選択だけ行い、**送信も DB 更新も一切しない**
 * （env 未設定のまま本番へ出ても勝手に送信が始まらないようにする既存 cron と同じ安全側）。
 */
export async function runBroadcastWorker(
  deps: BroadcastWorkerDeps,
  opts: {
    dryRun: boolean;
    maxBroadcasts?: number;
    timeBudgetMs?: number;
  },
): Promise<BroadcastWorkerResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const maxBroadcasts = opts.maxBroadcasts ?? WORKER_MAX_BROADCASTS;
  const budget = opts.timeBudgetMs ?? WORKER_TIME_BUDGET_MS;

  const targets = await deps.listSendingBroadcasts(maxBroadcasts);

  const result: BroadcastWorkerResult = {
    selected: targets.length,
    touched: 0, chunks: 0, processed: 0, sent: 0, failed: 0, casLost: 0,
    remainingBroadcasts: 0, budgetExhausted: false,
    elapsedMs: 0, dryRun: opts.dryRun,
  };

  if (opts.dryRun) {
    result.remainingBroadcasts = targets.length;
    result.elapsedMs = now() - startedAt;
    return result;
  }

  /** 直近 chunk の実測所要時間。次 chunk を始めてよいかの見積もりに使う。 */
  let lastChunkMs = WORKER_FIRST_CHUNK_ESTIMATE_MS;

  for (const b of targets) {
    let touchedThis = false;

    for (;;) {
      const elapsed = now() - startedAt;
      // 次の chunk を始めたら予算を超えそうなら、始めずに次回 cron へ回す。
      if (elapsed + lastChunkMs * WORKER_CHUNK_SAFETY_FACTOR > budget) {
        result.budgetExhausted = true;
        break;
      }

      const chunkStart = now();
      const r = await deps.processChunk({ oaId: b.oaId, broadcastId: b.id });
      lastChunkMs = Math.max(1, now() - chunkStart);

      if (!r.ok) break; // not_sending / invalid_content / no_token 等はこの Broadcast をスキップ

      result.chunks++;
      result.processed += r.processed;
      result.sent += r.sent;
      result.failed += r.failed;
      result.casLost += r.skipped;
      if (r.processed > 0 || r.skipped > 0) touchedThis = true;

      // 完了。最終 status と完了時刻は processChunk 側の既存 finalization が確定済み。
      if (!r.hasMore) break;

      // 1 件も claim できなかった = 残りは他 worker が処理中。ここで空回りしない。
      if (r.processed === 0 && r.skipped === 0) {
        result.remainingBroadcasts++;
        break;
      }
    }

    if (touchedThis) result.touched++;
    if (result.budgetExhausted) {
      // 未処理のまま残った Broadcast を残件として数える
      result.remainingBroadcasts += targets.length - targets.indexOf(b);
      break;
    }
  }

  result.elapsedMs = now() - startedAt;
  return result;
}
