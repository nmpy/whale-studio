// src/lib/scheduled-message.ts
//
// 時間差メッセージ（予約送信）の予約作成サービス（PR-3）。
//   - DB レコード（ScheduledLineMessage）を「作るだけ」。実 push 送信・cron は PR-4。
//   - webhook 内で sleep / setTimeout / fire-and-forget / push API は一切しない（純関数 + 1 回の create）。
//   - idempotencyKey（unique）で二重予約を防ぐ。
//   - キャンセル条件は JSON で保存し、PR-4 が送信直前に evaluateCancelPolicy で評価する。

// ── 定数 ──────────────────────────────────────────────
/** 送信タイミングの最小・最大（分）。0/負/極端な値は弾く/丸める。 */
export const MIN_DELAY_MINUTES = 1;
export const MAX_DELAY_MINUTES = 60 * 24 * 7; // 7 日

export type ScheduledStatus = "pending" | "sending" | "sent" | "canceled" | "failed";
export type ScheduledTriggerType = "message_action" | "keyword" | "qr" | "manual";

// ── 送信予定時刻 ───────────────────────────────────────
/**
 * 指定分数後の送信予定時刻（dueAt）を返す純関数。
 *   - delayMinutes が有限な正の値でなければ RangeError（過去/0/NaN/Infinity を拒否）。
 *   - MAX_DELAY_MINUTES を超える場合は MAX に丸める（clamp）。小数は分単位へ切り上げ。
 */
export function computeScheduledDueAt(now: Date, delayMinutes: number): Date {
  if (!Number.isFinite(delayMinutes) || delayMinutes < MIN_DELAY_MINUTES) {
    throw new RangeError(`送信タイミングは ${MIN_DELAY_MINUTES} 分以上で指定してください（received: ${delayMinutes}）`);
  }
  const minutes = Math.min(MAX_DELAY_MINUTES, Math.ceil(delayMinutes));
  return new Date(now.getTime() + minutes * 60_000);
}

// ── 冪等キー ───────────────────────────────────────────
/** dueAt を分バケットに丸めた数値（「同じ dueAt 相当」を1つに束ねる）。 */
function dueAtBucket(dueAt: Date): number {
  return Math.floor(dueAt.getTime() / 60_000);
}

/**
 * 二重予約防止の冪等キー（安定生成）。
 * `${lineUserId}:${workId}:${sourceMessageId|_}:${triggerEventId|_}:${dueAtBucket}`。
 * 同一ユーザー×作品×source×triggerEvent×dueAt(分) は 1 件に束ねる。
 */
export function buildScheduledMessageIdempotencyKey(parts: {
  lineUserId:       string;
  workId:           string;
  sourceMessageId?: string | null;
  triggerEventId?:  string | null;
  dueAt:            Date;
}): string {
  return [
    parts.lineUserId,
    parts.workId,
    parts.sourceMessageId?.trim() || "_",
    parts.triggerEventId?.trim() || "_",
    String(dueAtBucket(parts.dueAt)),
  ].join(":");
}

// ── キャンセル条件 ─────────────────────────────────────
/**
 * キャンセル条件。PR-4 の送信直前に evaluateCancelPolicy で評価する。
 *   - phaseChanged: 予約時の fromPhaseId から現在フェーズが変わっていたらキャンセル。
 *   - workCompleted: 作品終了済み（reachedEnding）ならキャンセル。
 *   - sameTrigger: 同一トリガーの予約が既にある場合は重複作成しない（作成時の判定。冪等キーで担保）。
 */
export interface ScheduledCancelPolicy {
  phaseChanged?:  { fromPhaseId: string | null };
  workCompleted?: boolean;
  sameTrigger?:   boolean;
}

export function buildCancelPolicy(args: {
  phaseId?:           string | null;
  cancelOnPhaseChange?:  boolean;
  cancelOnWorkComplete?: boolean;
  dedupeSameTrigger?:    boolean;
}): ScheduledCancelPolicy {
  const policy: ScheduledCancelPolicy = {};
  if (args.cancelOnPhaseChange) policy.phaseChanged = { fromPhaseId: args.phaseId ?? null };
  if (args.cancelOnWorkComplete) policy.workCompleted = true;
  if (args.dedupeSameTrigger) policy.sameTrigger = true;
  return policy;
}

/** 送信直前のキャンセル判定（PR-4 で使用。純関数）。最初に該当した理由を返す。 */
export function evaluateCancelPolicy(
  policy: ScheduledCancelPolicy | null | undefined,
  ctx:    { currentPhaseId: string | null; reachedEnding: boolean },
): { cancel: boolean; reason: "phase_changed" | "work_completed" | null } {
  if (!policy) return { cancel: false, reason: null };
  if (policy.workCompleted && ctx.reachedEnding) return { cancel: true, reason: "work_completed" };
  if (policy.phaseChanged && policy.phaseChanged.fromPhaseId != null && ctx.currentPhaseId !== policy.phaseChanged.fromPhaseId) {
    return { cancel: true, reason: "phase_changed" };
  }
  return { cancel: false, reason: null };
}

// ── 予約レコード入力の構築 ─────────────────────────────
/** 予約メッセージの送信内容（将来の push で使う形）。 */
/** PR-SER2 サーバ feature flag: 直列進行の「送信側 hold truncation ＋ resume cursor 保存」を有効化する。
 *  OFF / 未設定 = 完全に現状維持（hold_chain_until_sent=true でも truncation は発火せず resume も保存しない）。
 *  worker resume（PR-SER3）が未実装の間、本番では**未設定**にして「後続が止まって再開されない」未完成挙動を防ぐ。
 *  検証は staging env にのみ ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION=true を設定して行う。 */
export function isHoldChainTruncationEnabled(): boolean {
  return process.env.ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION === "true";
}

/** PR-SER3: 予約 payloadJson から resume cursor（後続再開先 message id）を安全に取り出す。
 *  resume が無い / 不正 JSON / next_message_id が空 → null（= 後続再開なし）。PII は読まない（id のみ）。 */
export function parseResumeCursor(payloadJson: string | null | undefined): string | null {
  if (!payloadJson) return null;
  try {
    const p = JSON.parse(payloadJson) as { resume?: { next_message_id?: unknown } };
    const id = p?.resume?.next_message_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export interface ScheduledMessagePayload {
  message_type: string;          // "text" | "image" 等
  body?:        string | null;
  asset_url?:   string | null;
  character_id?: string | null;  // 発話キャラクター
  /** PR-SER2: 直列進行（hold_chain_until_sent）の再開カーソル。
   *  この予約 push 完了後、PR-SER3 の worker が next_message_id から後続チェーンを再開する。
   *  hold OFF / 後続なしのときは未設定（= 後続再開なし）。 */
  resume?: { next_message_id: string };
}

export interface BuildScheduledInputArgs {
  oaId:             string;
  workId:           string;
  lineUserId:       string;
  userProgressId?:  string | null;
  phaseId?:         string | null;
  sourceMessageId?: string | null;
  triggerType:      ScheduledTriggerType | string;
  triggerEventId?:  string | null;
  dueAt:            Date;
  payload:          ScheduledMessagePayload;
  cancelPolicy?:    ScheduledCancelPolicy;
}

/** Prisma create に渡す data（純関数。status は常に "pending"・JSON は文字列化）。 */
export interface ScheduledCreateInput {
  oaId:             string;
  workId:           string;
  lineUserId:       string;
  userProgressId:   string | null;
  phaseId:          string | null;
  sourceMessageId:  string | null;
  triggerType:      string;
  triggerEventId:   string | null;
  dueAt:            Date;
  status:           "pending";
  payloadJson:      string;
  cancelPolicyJson: string | null;
  idempotencyKey:   string;
}

export function buildScheduledLineMessageInput(args: BuildScheduledInputArgs): ScheduledCreateInput {
  const idempotencyKey = buildScheduledMessageIdempotencyKey({
    lineUserId:      args.lineUserId,
    workId:          args.workId,
    sourceMessageId: args.sourceMessageId,
    triggerEventId:  args.triggerEventId,
    dueAt:           args.dueAt,
  });
  return {
    oaId:             args.oaId,
    workId:           args.workId,
    lineUserId:       args.lineUserId,
    userProgressId:   args.userProgressId ?? null,
    phaseId:          args.phaseId ?? null,
    sourceMessageId:  args.sourceMessageId ?? null,
    triggerType:      args.triggerType,
    triggerEventId:   args.triggerEventId ?? null,
    dueAt:            args.dueAt,
    status:           "pending",
    payloadJson:      JSON.stringify(args.payload),
    cancelPolicyJson: args.cancelPolicy ? JSON.stringify(args.cancelPolicy) : null,
    idempotencyKey,
  };
}

// ── 作成（重複防止つき）──────────────────────────────────
/** create に必要な最小 DB インターフェース（テスト時は in-memory 実装を注入）。 */
export interface ScheduledMessageDb {
  findUnique(args: { where: { idempotencyKey: string } }): Promise<{ id: string; status: string } | null>;
  create(args: { data: ScheduledCreateInput }): Promise<{ id: string; status: string }>;
}

/** 既存予約を冪等キーで探す。 */
export function findExistingScheduledMessage(db: ScheduledMessageDb, idempotencyKey: string) {
  return db.findUnique({ where: { idempotencyKey } });
}

/** 既存があれば新規作成しない（status を問わず冪等キー単位で 1 件に束ねる）。 */
export function shouldCreateScheduledMessage(existing: { status: string } | null): boolean {
  return existing == null;
}

/**
 * 予約レコードを作成する（status="pending"）。
 *   - 同一冪等キーの既存があれば作成せず既存を返す（created:false）。
 *   - 競合（同時 create で unique 衝突）時は再取得して既存を返す。
 * 実 push 送信は行わない（PR-3）。
 */
export async function createScheduledLineMessage(
  db:   ScheduledMessageDb,
  args: BuildScheduledInputArgs,
): Promise<{ created: boolean; record: { id: string; status: string } }> {
  const input = buildScheduledLineMessageInput(args);
  const existing = await findExistingScheduledMessage(db, input.idempotencyKey);
  if (!shouldCreateScheduledMessage(existing)) {
    return { created: false, record: existing! };
  }
  try {
    const record = await db.create({ data: input });
    return { created: true, record };
  } catch (err) {
    // unique 衝突（P2002）等 = 直前に別経路が作成した → 再取得して既存を返す（二重予約を作らない）。
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      const again = await findExistingScheduledMessage(db, input.idempotencyKey);
      if (again) return { created: false, record: again };
    }
    throw err;
  }
}
