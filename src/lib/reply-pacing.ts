// src/lib/reply-pacing.ts
//
// reply pacing / reply pre-delay。
//
// 重要（できないことを実装できたように見せない）:
//   LINE Messaging API では replyToken は 1 回しか使えず、reply API は 1 リクエストで最大 5 件の
//   message object を「まとめて」送る形式。よって「複数メッセージを 1.5 秒間隔で個別着弾させる」ことは
//   reply-only では実現できない（push を使えば可能だが、本機能は課金通数を増やさないため reply のみ）。
//
//   ここで行うのは sequential send interval ではなく **reply pacing / reply pre-delay**:
//     「単一 reply を送る直前に、件数に応じた pre-delay を 1 回だけ入れて、5 件が即時に届く体感を和らげる」。
//   reply API の呼び出しは 1 回のみ・push は使わない・replyToken も 1 回のみ。

/** メッセージが 1 件増えるごとに加える pre-delay（ms）。「個別着弾の間隔」ではない点に注意。 */
export const REPLY_PACING_INTERVAL_MS = 1500;

/** replyToken 失効リスクを避けるための pre-delay 上限（ms）。reply は最大5件なので通常6秒前後。 */
export const MAX_REPLY_PACING_DELAY_MS = 8000;

/**
 * 単一 reply 送信前の pre-delay（ms）。
 *   - 1 件以下: 0
 *   - delayMs = max(0, count-1) * REPLY_PACING_INTERVAL_MS（MAX_REPLY_PACING_DELAY_MS で clamp）
 */
export function computeReplyPacingDelayMs(messageCount: number): number {
  const n = Number.isFinite(messageCount) ? Math.floor(messageCount) : 0;
  const raw = Math.max(0, n - 1) * REPLY_PACING_INTERVAL_MS;
  return Math.min(MAX_REPLY_PACING_DELAY_MS, raw);
}

/** loading indicator の秒数（LINE 仕様 5〜60 秒に clamp。delay を秒へ切り上げ）。 */
export function computePacingLoadingSeconds(delayMs: number): number {
  const secs = Math.ceil(Math.max(0, delayMs) / 1000);
  return Math.max(5, Math.min(60, secs));
}

export interface ApplyReplyPacingResult {
  delayMs:        number;
  loadingSeconds: number | null;
  loadingShown:   boolean;
  /** PII を含まない skip 理由（no_delay / not_1to1 / no_loading_fn / loading_error / null）。 */
  skipped:        string | null;
}

/**
 * 単一 reply を送る「直前」に呼ぶ pacing 処理（reply/push は呼ばない）。
 *   - delayMs を 1 回だけ sleep する（pre-delay）。
 *   - 1 対 1（userId あり）かつ delay>0 かつ showLoading 提供時のみ loading indicator を併用する。
 *   - loading の失敗は reply 本体を失敗させない（握りつぶして続行）。
 *   - test では sleepFn / showLoading を注入して実時間待機・実 API 呼び出しを回避できる。
 */
export async function applyReplyPacing(opts: {
  messageCount: number;
  /** 1 対 1 判定。空 / 未取得（group/room/unknown）は loading を出さない。 */
  userId?:      string | null;
  /** loading indicator 実行関数（未指定＝loading なし・delay のみ）。失敗は内部で握りつぶす。 */
  showLoading?: (userId: string, loadingSeconds: number) => Promise<unknown>;
  /** sleep 関数（test 用に注入可能。実時間待機を避ける）。 */
  sleepFn:      (ms: number) => Promise<void>;
  /** PII を含まない構造化ログ（任意）。 */
  log?:         (info: { messageCount: number; delayMs: number; loadingSeconds: number | null; skipped: string | null }) => void;
}): Promise<ApplyReplyPacingResult> {
  const delayMs = computeReplyPacingDelayMs(opts.messageCount);

  // delay 0（1 件以下）→ pre-delay も loading も出さない。
  if (delayMs <= 0) {
    opts.log?.({ messageCount: opts.messageCount, delayMs: 0, loadingSeconds: null, skipped: "no_delay" });
    return { delayMs: 0, loadingSeconds: null, loadingShown: false, skipped: "no_delay" };
  }

  let loadingSeconds: number | null = null;
  let loadingShown = false;
  let skipped: string | null = null;

  const is1to1 = !!opts.userId && opts.userId.length > 0;
  if (!opts.showLoading) {
    skipped = "no_loading_fn";
  } else if (!is1to1) {
    skipped = "not_1to1";
  } else {
    loadingSeconds = computePacingLoadingSeconds(delayMs);
    try {
      await opts.showLoading(opts.userId!, loadingSeconds);
      loadingShown = true;
    } catch {
      // loading 失敗は無視して reply を続行する（reply 本体を失敗させない）。
      loadingShown = false;
      skipped = "loading_error";
    }
  }

  opts.log?.({ messageCount: opts.messageCount, delayMs, loadingSeconds, skipped });

  // 単一 reply の「送信前」に 1 回だけ待機する（個別着弾の間隔ではない）。
  await opts.sleepFn(delayMs);

  return { delayMs, loadingSeconds, loadingShown, skipped };
}
