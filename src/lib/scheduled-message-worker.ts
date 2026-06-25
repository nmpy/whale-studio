// src/lib/scheduled-message-worker.ts
//
// 時間差メッセージ（予約送信）worker の土台（PR-4a）。
//   - dueAt<=now かつ status=pending の予約を拾い、pending→sending に **atomic claim** して二重処理を防ぐ。
//   - claim 後に evaluateCancelPolicy を「送信直前相当」で評価し、該当すれば canceled にする。
//   - 実 LINE push 送信は **まだ行わない**（PR-4a）。sender は注入可能で、既定は no-op（送信しない）。
//     実 push は PR-4b で注入する real sender が担う。
//
// 禁止（PR-4a）: 実 push API 呼び出し / webhook からの予約作成 / replyToken / sleep / setTimeout /
//   fire-and-forget。worker は「拾う・ロックする・キャンセル判定する」までで、送信はしない。
//
// DB 操作・userProgress 取得・sender・now はすべて注入可能（テスト容易・本番は prisma アダプタを渡す）。

import {
  evaluateCancelPolicy, isHoldChainTruncationEnabled, parseResumeCursor,
  type ScheduledCancelPolicy,
} from "@/lib/scheduled-message";

/** worker が処理する pending 予約の最小形。PII（payload 本文・lineUserId）はログ/レスポンスに出さない。 */
export interface PendingScheduledRow {
  id:               string;
  workId:           string;
  lineUserId:       string;
  userProgressId:   string | null;
  phaseId:          string | null;
  cancelPolicyJson: string | null;
  /** 送信元 OA（channelAccessToken 解決に使う）。 */
  oaId:             string;
  /** この予約の発生元 message id（PR-SER3: resume ログの追跡に使う。本文ではなく id のみ）。 */
  sourceMessageId:  string | null;
  /** 送信予定メッセージ内容（JSON 文字列。real sender が LINE message へ復元）。 */
  payloadJson:      string;
  /** 現在のリトライ回数（retry 判定に使う）。 */
  retryCount:       number;
}

/**
 * PR-SER3 直列進行 resume: 予約 push 成功＆ markSent 後に **1回だけ**呼ばれる後続チェーン再開アダプタ。
 * 実体（フェーズ取得 / drain / push / 再arm）は scheduled-message-resume.ts に置き、worker は orchestration のみ。
 * ok=false は「resume 失敗（後続未送信）」だが、予約本文 push は成功済みなので **二重 push はしない**（安全側）。
 */
export interface ResumeChainArgs { row: PendingScheduledRow; nextMessageId: string; now: Date; }
export interface ResumeChainOutcome {
  ok:                   boolean;
  /** 失敗/スキップの安全な分類名（PII なし）: invalid_next_message / no_sendable / push_failed / fetch_failed 等。 */
  reason?:              string;
  /** 送信した後続メッセージ数（参考）。 */
  sentCount?:           number;
  /** 再arm で作成した次予約数（参考）。 */
  rearmed?:             number;
  /** 後続も hold だった場合の次段 resume cursor（参考・ログ用）。 */
  nextResumeMessageId?: string | null;
}
export type ResumeChain = (args: ResumeChainArgs) => Promise<ResumeChainOutcome>;

/** 送信直前のユーザー進行状態（キャンセル判定に使う）。 */
export interface UserProgressState {
  currentPhaseId: string | null;
  reachedEnding:  boolean;
}

/**
 * sender 結果。PR-4a の no-op は {sent:false}（error なし）= 送信せず claimed 扱い。
 * PR-4b の real sender は成功で sent:true、失敗で error（安全な分類名）+ retryable を返す。
 * status/error に token・本文・userId は含めない。
 */
export interface SenderResult {
  sent:       boolean;
  requestId?: string | null;
  /** 失敗時の安全な分類名（PII/token を含めない）。 */
  error?:     string;
  /** LINE の HTTP status（分類の参考。任意）。 */
  status?:    number;
  /** 失敗が再試行可能か（network/5xx=true、quota/blocked/invalid=false）。 */
  retryable?: boolean;
}
export type ScheduledSender = (row: PendingScheduledRow) => Promise<SenderResult>;

/** 何も送信しない sender（PR-4a 本番既定）。実 push API は呼ばない。 */
export const noopSender: ScheduledSender = async () => ({ sent: false });

/** リトライ上限。これを超えたら failed にする。 */
export const MAX_RETRY_COUNT = 3;
/** sending のまま滞留とみなす経過時間（ms）。これより古い sending は recover 対象。 */
export const STUCK_SENDING_MS = 10 * 60_000;

/** リトライ時の次回送信予定（単純 backoff: 1分 / 5分 / 15分）。 */
export function nextRetryDueAt(now: Date, retryCount: number): Date {
  const mins = [1, 5, 15];
  return new Date(now.getTime() + mins[Math.min(retryCount - 1, mins.length - 1)] * 60_000);
}

/** worker が必要とする DB 操作（prisma を直接持たず注入。テストは in-memory を渡す）。 */
export interface ScheduledWorkerDb {
  /** dueAt<=now かつ status=pending を dueAt 昇順で最大 limit 件。 */
  findDuePending(args: { now: Date; limit: number }): Promise<PendingScheduledRow[]>;
  /** pending→sending の atomic claim。更新できた件数（1=自分が獲得 / 0=他 worker が獲得済み）を返す。 */
  claimToSending(id: string, now: Date): Promise<number>;
  /** sending→canceled（理由を lastError、canceledAt を記録）。 */
  markCanceled(id: string, reason: string, now: Date): Promise<void>;
  /** sending→sent（real sender 成功時。requestId を記録）。 */
  markSent(id: string, requestId: string | null, now: Date): Promise<void>;
  /** sending→failed（非retry / retry 上限超過 / recover）。理由を lastError、retryCount を記録。 */
  markFailed(id: string, reason: string, retryCount: number, now: Date): Promise<void>;
  /** sending→pending に戻す（retry）。retryCount/lastError/次回 dueAt を記録。 */
  markRetry(id: string, retryCount: number, lastError: string, nextDueAt: Date): Promise<void>;
  /** updatedAt が now-threshold より前の status=sending（滞留）を最大 limit 件。 */
  findStuckSending(args: { now: Date; thresholdMs: number; limit: number }): Promise<{ id: string; retryCount: number }[]>;
}

export interface WorkerResult {
  /** live: claim 成功で sending として残った件数 / dryRun: 送信されるはずだった件数（would-send）。 */
  claimed:  number;
  /** live: canceled にした件数 / dryRun: キャンセルされるはずだった件数（would-cancel）。 */
  canceled: number;
  /** claim できなかった（他 worker が先取り / 既に pending でない）件数。dryRun では常に 0。 */
  skipped:  number;
  /** real sender が送信成功して sent にした件数（PR-4a no-op / dryRun では 0）。 */
  sent:     number;
  /** 送信失敗で failed にした件数（非retry / retry 上限超過）。dryRun では 0。 */
  failed:   number;
  /** 送信失敗で retry（pending へ戻した）件数。dryRun では 0。 */
  retried:  number;
  /** sending 滞留を recover（failed 化）した件数。dryRun では「候補数」を数える（変更はしない）。 */
  recovered: number;
  /** 行単位の処理で例外が出た件数（worker 全体は落とさない）。 */
  errors:   number;
  /** PR-SER3: 予約 push 成功後に後続チェーンを再開（resumeChain ok）した件数。 */
  resumed:      number;
  /** PR-SER3: resume を試みたが失敗（invalid/fetch/push 失敗・例外）した件数。予約は sent のまま（二重 push しない）。 */
  resumeFailed: number;
  /** PR-SER3: resume cursor はあるが実行しなかった件数（flag OFF / アダプタ未注入）。 */
  resumeSkipped: number;
  /** dryRun（DB を変更しない読み取り評価）だったか。 */
  dryRun:   boolean;
}

export interface WorkerDeps {
  db:              ScheduledWorkerDb;
  /** 予約に紐づくユーザー進行を取得（キャンセル判定用）。取得不能なら null。 */
  getUserProgress: (row: PendingScheduledRow) => Promise<UserProgressState | null>;
  now:             Date;
  /** 1 回の実行で処理する最大件数。 */
  batchSize?:      number;
  /** 送信実装（既定 no-op = 送信しない）。PR-4b で real LINE push を注入。 */
  sender?:         ScheduledSender;
  /**
   * PR-SER3 直列進行: 予約 push 成功＆ markSent 後に後続チェーンを再開するアダプタ（任意）。
   * 未注入なら resume しない（resumeSkipped で計上）。flag OFF / dryRun でも resume しない。
   */
  resumeChain?:    ResumeChain;
  /**
   * dryRun=true: **DB を一切変更しない**読み取り評価のみ（findDuePending + getUserProgress を読むだけ）。
   *   「いま実行したら何件 send / cancel されるか」を返す。claim も markCanceled/markSent もしない。
   *   PR-4a で本番公開する cron route はこちらを使う（no-op sender のまま pending→sending に滞留させない）。
   * dryRun=false（既定）: live mode。claim→sending・canceled・(real sender 時)sent まで実際に遷移させる。
   *   PR-4b で real sender とともに有効化する。
   */
  dryRun?:         boolean;
}

export const DEFAULT_BATCH_SIZE = 20;

/** cancelPolicyJson を安全に parse（壊れていても worker を落とさず null 扱い）。 */
function parseCancelPolicy(json: string | null): ScheduledCancelPolicy | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as ScheduledCancelPolicy) : null;
  } catch {
    return null;
  }
}

/**
 * worker 本体。
 *   1) recover: sending のまま滞留した行を安全側で failed 化（dryRun は候補数のみ）。
 *   2) dueAt<=now の pending を拾い、atomic claim → キャンセル判定 → real sender で push → sent/failed/retry。
 * 返すのは件数のみ（PII は含めない）。実 push は sender 注入に委ねる（既定 no-op）。
 */
export async function runScheduledMessageWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const sender = deps.sender ?? noopSender;
  const dryRun = deps.dryRun ?? false;
  const result: WorkerResult = { claimed: 0, canceled: 0, skipped: 0, sent: 0, failed: 0, retried: 0, recovered: 0, errors: 0, resumed: 0, resumeFailed: 0, resumeSkipped: 0, dryRun };

  /** キャンセル判定（読み取りのみ）。progress 取得不能は安全側＝cancel しない。 */
  async function shouldCancel(row: PendingScheduledRow): Promise<{ cancel: boolean; reason: string | null }> {
    const policy = parseCancelPolicy(row.cancelPolicyJson);
    if (!policy || !(policy.phaseChanged || policy.workCompleted)) return { cancel: false, reason: null };
    const progress = await deps.getUserProgress(row);
    if (!progress) return { cancel: false, reason: null }; // 判定不能 → 誤 cancel しない
    return evaluateCancelPolicy(policy, progress);
  }

  /**
   * PR-SER3 直列進行 resume: 予約 push 成功＆ markSent 後に **1回だけ**呼ぶ。
   *   - resume cursor（payload.resume.next_message_id）が無ければ何もしない。
   *   - flag OFF / resumeChain 未注入なら resumeSkipped（後続再開せず・予約は sent のまま）。
   *   - resumeChain ok → resumed / 失敗・例外 → resumeFailed（warning ログ・PII なし）。
   *   失敗しても予約は sent のまま（= 予約本文 push の二重実行はしない。後続未送信は許容＝二重送信回避優先）。
   *   将来: resumeFailed の自動 retry / repair は別 PR 候補（ここでは再送しない）。 // TODO(PR-SER4?): resume retry/repair
   */
  async function maybeResume(row: PendingScheduledRow): Promise<void> {
    const nextMessageId = parseResumeCursor(row.payloadJson);
    if (!nextMessageId) return;                                  // resume cursor なし＝従来どおり単発で終了
    if (!isHoldChainTruncationEnabled() || !deps.resumeChain) {  // flag OFF / アダプタ無し → resume しない
      result.resumeSkipped++;
      return;
    }
    try {
      const outcome = await deps.resumeChain({ row, nextMessageId, now: deps.now });
      if (outcome?.ok) {
        result.resumed++;
      } else {
        result.resumeFailed++;
        console.warn("[scheduled-resume:failed]", JSON.stringify({
          scheduledLineMessageId: row.id, sourceMessageId: row.sourceMessageId, nextMessageId,
          reason: outcome?.reason ?? "unknown",
        }));
      }
    } catch {
      // resume の例外は worker を落とさない。予約は sent のまま（二重 push なし）。
      result.resumeFailed++;
      console.warn("[scheduled-resume:failed]", JSON.stringify({
        scheduledLineMessageId: row.id, sourceMessageId: row.sourceMessageId, nextMessageId, reason: "exception",
      }));
    }
  }

  // ── recover phase: sending のまま滞留した行を安全側で処理 ──
  //   送信成功後に status 更新だけ失敗したケースだと、pending へ戻すと**二重送信**の恐れがある。
  //   そのため最初は安全側＝**failed 化**（自動再送はしない）。X-Line-Retry-Key/lineRequestId による
  //   厳密な再送可否判定は将来（PR-4c）。dryRun では DB を変えず候補数だけ数える。
  try {
    const stuck = await deps.db.findStuckSending({ now: deps.now, thresholdMs: STUCK_SENDING_MS, limit: batchSize });
    for (const s of stuck) {
      if (!dryRun) await deps.db.markFailed(s.id, "stuck_sending_recovered", s.retryCount, deps.now);
      result.recovered++;
    }
  } catch {
    result.errors++;
  }

  const due = await deps.db.findDuePending({ now: deps.now, limit: batchSize });

  for (const row of due) {
    try {
      if (dryRun) {
        // ── dryRun: DB を一切変更しない。何件 send/cancel されるかだけ数える（claim も sender もしない）。 ──
        const { cancel } = await shouldCancel(row);
        if (cancel) result.canceled++; else result.claimed++;
        continue;
      }

      // ── live mode ── atomic claim（pending→sending）。0 件なら他 worker が先取り済み = skip。 ──
      const claimedCount = await deps.db.claimToSending(row.id, deps.now);
      if (claimedCount === 0) { result.skipped++; continue; }

      // ── 送信直前のキャンセル判定（push を呼ばずに canceled にする）──
      const { cancel, reason } = await shouldCancel(row);
      if (cancel && reason) {
        await deps.db.markCanceled(row.id, reason, deps.now);
        result.canceled++;
        continue;
      }
      // progress 取得不能等で判定できない場合は安全側: 誤 cancel せず送信を試みる。

      // ── 送信（real sender = LINE push。no-op の場合は sent:false/error なし → sending のまま claimed）──
      const sendResult = await sender(row);
      if (sendResult.sent) {
        // 順序が idempotency の要: 必ず markSent（DB commit）→ その後 resume。
        //   sent になった予約は findDuePending に再 pick されない＝予約本文 push/resume は1回のみ。
        await deps.db.markSent(row.id, sendResult.requestId ?? null, deps.now);
        result.sent++;
        await maybeResume(row);   // PR-SER3: markSent 後にだけ後続チェーンを再開（flag/アダプタ gated・例外は内部処理）
      } else if (sendResult.error) {
        // 実送信の失敗。分類に応じて retry（pending へ戻す）or failed。
        const newRetry = row.retryCount + 1;
        if (sendResult.retryable && newRetry <= MAX_RETRY_COUNT) {
          await deps.db.markRetry(row.id, newRetry, sendResult.error, nextRetryDueAt(deps.now, newRetry));
          result.retried++;
        } else {
          await deps.db.markFailed(row.id, sendResult.error, newRetry, deps.now);
          result.failed++;
        }
      } else {
        // no-op sender（error なし）: PR-4a 互換。送信せず sending のまま claimed として計上。
        result.claimed++;
      }
    } catch {
      // 行単位のエラーは worker 全体を落とさない。例外内容は PII を含み得るためログに出さない。
      result.errors++;
    }
  }

  return result;
}
