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

import { evaluateCancelPolicy, type ScheduledCancelPolicy } from "@/lib/scheduled-message";

/** worker が処理する pending 予約の最小形。PII（payload 本文・lineUserId）はログ/レスポンスに出さない。 */
export interface PendingScheduledRow {
  id:               string;
  workId:           string;
  lineUserId:       string;
  userProgressId:   string | null;
  phaseId:          string | null;
  cancelPolicyJson: string | null;
}

/** 送信直前のユーザー進行状態（キャンセル判定に使う）。 */
export interface UserProgressState {
  currentPhaseId: string | null;
  reachedEnding:  boolean;
}

/** sender 結果。PR-4a の no-op は sent:false を返す（= 送信しない）。PR-4b の real sender が sent:true を返す。 */
export interface SenderResult {
  sent:       boolean;
  requestId?: string | null;
  error?:     string;
}
export type ScheduledSender = (row: PendingScheduledRow) => Promise<SenderResult>;

/** 何も送信しない sender（PR-4a 本番既定）。実 push API は呼ばない。 */
export const noopSender: ScheduledSender = async () => ({ sent: false });

/** worker が必要とする DB 操作（prisma を直接持たず注入。テストは in-memory を渡す）。 */
export interface ScheduledWorkerDb {
  /** dueAt<=now かつ status=pending を dueAt 昇順で最大 limit 件。 */
  findDuePending(args: { now: Date; limit: number }): Promise<PendingScheduledRow[]>;
  /** pending→sending の atomic claim。更新できた件数（1=自分が獲得 / 0=他 worker が獲得済み）を返す。 */
  claimToSending(id: string, now: Date): Promise<number>;
  /** sending→canceled（理由を lastError、canceledAt を記録）。 */
  markCanceled(id: string, reason: string, now: Date): Promise<void>;
  /** sending→sent（PR-4b の real sender 成功時のみ。requestId を記録）。 */
  markSent(id: string, requestId: string | null, now: Date): Promise<void>;
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
  /** 行単位の処理で例外が出た件数（worker 全体は落とさない）。 */
  errors:   number;
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
 * worker 本体。dueAt<=now の pending を拾い、claim → キャンセル判定 → (PR-4a は) sending のまま残す。
 * 返すのは件数のみ（PII は含めない）。実 push は sender 注入に委ねる（既定 no-op）。
 */
export async function runScheduledMessageWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const sender = deps.sender ?? noopSender;
  const dryRun = deps.dryRun ?? false;
  const result: WorkerResult = { claimed: 0, canceled: 0, skipped: 0, sent: 0, errors: 0, dryRun };

  /** キャンセル判定（読み取りのみ）。progress 取得不能は安全側＝cancel しない。 */
  async function shouldCancel(row: PendingScheduledRow): Promise<{ cancel: boolean; reason: string | null }> {
    const policy = parseCancelPolicy(row.cancelPolicyJson);
    if (!policy || !(policy.phaseChanged || policy.workCompleted)) return { cancel: false, reason: null };
    const progress = await deps.getUserProgress(row);
    if (!progress) return { cancel: false, reason: null }; // 判定不能 → 誤 cancel しない
    return evaluateCancelPolicy(policy, progress);
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

      // ── 送信直前のキャンセル判定 ──
      const { cancel, reason } = await shouldCancel(row);
      if (cancel && reason) {
        await deps.db.markCanceled(row.id, reason, deps.now);
        result.canceled++;
        continue;
      }
      // progress 取得不能等で判定できない場合は安全側: canceled にも sent にもせず sending のまま残す。
      // TODO(PR-4b): sending のまま滞留した予約の timeout/recover（再評価・再送 or failed）を実装する。

      // ── 送信（PR-4a は no-op = sent:false → sending のまま claimed として計上）。 ──
      const sendResult = await sender(row);
      if (sendResult.sent) {
        await deps.db.markSent(row.id, sendResult.requestId ?? null, deps.now);
        result.sent++;
      } else {
        result.claimed++;
      }
    } catch {
      // 行単位のエラーは worker 全体を落とさない。例外内容は PII を含み得るためログに出さない。
      result.errors++;
    }
  }

  return result;
}
