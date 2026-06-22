// src/lib/line-read-receipt.ts
// LINE 既読制御 & ローディングアニメーション & typing 演出
//
// 責務:
//   - Mark as Read API 呼び出し（遅延制御付き）
//   - Loading Animation API 呼び出し（可変秒数）
//   - Typing 風待機（返信前の自然な間）
//   - ReadReceiptController: 1 イベントの既読・typing・ローディングタイミングを統合管理
//   - resolveMessageTimingConfig: メッセージ / 作品 / 環境変数の設定マージ
//
// LINE API リファレンス:
//   - Mark as Read: POST https://api.line.me/v2/bot/chat/markAsRead
//   - Loading:      POST https://api.line.me/v2/bot/chat/loading/start

import type { MessageTimingConfig } from "@/types";

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────

const LINE_MARK_AS_READ_URL    = "https://api.line.me/v2/bot/chat/markAsRead";
const LINE_LOADING_START_URL   = "https://api.line.me/v2/bot/chat/loading/start";

/** デフォルトの既読遅延（ms） */
const DEFAULT_READ_DELAY_MS        = 2000;
/** 既読遅延の最大値（ms）— これを超えるとユーザーが不安になる */
const MAX_READ_DELAY_MS            = 10000;
/** デフォルトのローディング表示閾値（ms）— 処理時間がこれを超えたらローディング表示 */
const DEFAULT_LOADING_THRESHOLD_MS = 3000;
/** ローディングのデフォルト最小秒数 */
const DEFAULT_LOADING_MIN_SECONDS  = 5;
/** ローディングのデフォルト最大秒数 */
const DEFAULT_LOADING_MAX_SECONDS  = 15;
/** typing 風待機のデフォルト最小（ms） */
const DEFAULT_TYPING_MIN_MS        = 300;
/** typing 風待機のデフォルト最大（ms） */
const DEFAULT_TYPING_MAX_MS        = 1200;

/** ms ミリ秒待機する */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ────────────────────────────────────────────────
// 設定型
// ────────────────────────────────────────────────

export type ReadReceiptConfig = {
  /** 既読制御を有効にするか（false なら即既読のまま＝従来動作） */
  enabled: boolean;
  /** 既読を遅延させる時間（ms） */
  readDelayMs: number;
  /** ローディングアニメーションを有効にするか */
  loadingEnabled: boolean;
  /** ローディング表示の閾値（ms）— 処理時間がこれを超えたら表示 */
  loadingThresholdMs: number;
  /** ローディング最小秒数（5〜60） */
  loadingMinSeconds: number;
  /** ローディング最大秒数（5〜60） */
  loadingMaxSeconds: number;
  /** typing 風待機を有効にするか */
  typingEnabled: boolean;
  /** typing 最小待機（ms） */
  typingMinMs: number;
  /** typing 最大待機（ms） */
  typingMaxMs: number;
};

// ────────────────────────────────────────────────
// 環境変数から設定を読み取る
// ────────────────────────────────────────────────

function parseIntEnv(key: string): number | undefined {
  const v = parseInt(process.env[key] ?? "", 10);
  return isNaN(v) ? undefined : v;
}

function loadConfigFromEnv(): ReadReceiptConfig {
  return {
    enabled:            process.env.READ_RECEIPT_ENABLED !== "false",
    readDelayMs:        clampReadDelay(parseIntEnv("READ_DELAY_MS") ?? DEFAULT_READ_DELAY_MS),
    loadingEnabled:     process.env.LOADING_ANIMATION_ENABLED !== "false",
    loadingThresholdMs: Math.max(0, parseIntEnv("LOADING_THRESHOLD_MS") ?? DEFAULT_LOADING_THRESHOLD_MS),
    loadingMinSeconds:  Math.max(3, Math.min(60, parseIntEnv("LOADING_SECONDS_MIN") ?? DEFAULT_LOADING_MIN_SECONDS)),
    loadingMaxSeconds:  Math.max(3, Math.min(60, parseIntEnv("LOADING_SECONDS_MAX") ?? DEFAULT_LOADING_MAX_SECONDS)),
    typingEnabled:      process.env.TYPING_ENABLED === "true",
    typingMinMs:        Math.max(0, parseIntEnv("TYPING_MIN_MS") ?? DEFAULT_TYPING_MIN_MS),
    typingMaxMs:        Math.max(0, parseIntEnv("TYPING_MAX_MS") ?? DEFAULT_TYPING_MAX_MS),
  };
}

function clampReadDelay(ms: number): number {
  return Math.max(0, Math.min(ms, MAX_READ_DELAY_MS));
}

/** グローバル設定（プロセス起動時に一度だけ読み込む） */
const globalConfig = loadConfigFromEnv();

/**
 * 作品単位の設定で上書き可能にするための設定取得関数。
 * 将来 DB の Oa / Work テーブルに設定カラムを追加した場合はここで merge する。
 */
export function getConfig(overrides?: Partial<ReadReceiptConfig>): ReadReceiptConfig {
  if (!overrides) return globalConfig;
  return { ...globalConfig, ...overrides };
}

// ────────────────────────────────────────────────
// テキスト長に応じた動的既読遅延
// ────────────────────────────────────────────────

const READ_DELAY_TIERS: { maxLength: number; delayMs: number }[] = (() => {
  const env = process.env.READ_DELAY_TIERS; // 例: "10:1000,50:2000,*:3000"
  if (env) {
    try {
      const tiers = env.split(",").map((seg) => {
        const [len, ms] = seg.split(":");
        return {
          maxLength: len.trim() === "*" ? Infinity : parseInt(len.trim(), 10),
          delayMs:   parseInt(ms.trim(), 10),
        };
      });
      if (tiers.every((t) => !isNaN(t.delayMs) && !isNaN(t.maxLength))) {
        return tiers.sort((a, b) => a.maxLength - b.maxLength);
      }
    } catch { /* fall through to default */ }
    console.warn("[line-read-receipt] READ_DELAY_TIERS の書式が不正です。デフォルトを使用します。");
  }
  return [
    { maxLength: 10,       delayMs: 1000 },
    { maxLength: 50,       delayMs: 2000 },
    { maxLength: Infinity, delayMs: 3000 },
  ];
})();

export function calcReadDelayByTextLength(textLength: number): number {
  for (const tier of READ_DELAY_TIERS) {
    if (textLength < tier.maxLength) {
      return clampReadDelay(tier.delayMs);
    }
  }
  return clampReadDelay(READ_DELAY_TIERS[READ_DELAY_TIERS.length - 1].delayMs);
}

// ────────────────────────────────────────────────
// メッセージ演出設定のマージ（優先順位解決）
// ────────────────────────────────────────────────

/**
 * 解決済みの演出タイミング設定。
 * すべてのフィールドが確定値（null なし）。
 */
export type ResolvedTimingConfig = {
  readReceiptMode:    "immediate" | "delayed" | "before_reply";
  readDelayMs:        number;
  typingEnabled:      boolean;
  typingMinMs:        number;
  typingMaxMs:        number;
  loadingEnabled:     boolean;
  loadingThresholdMs: number;
  loadingMinSeconds:  number;
  loadingMaxSeconds:  number;
};

/**
 * メッセージ単位の設定だけを参照して解決する。
 *
 * 仕様 (= 継承モード廃止):
 *   - msgConfig 内の各フィールドが null / undefined / "inherit" の場合は **OFF 扱い**:
 *     - readReceiptMode → "immediate" (人為的な既読遅延なし)
 *     - typingEnabled / loadingEnabled → false
 *   - 数値フィールド (read_delay_ms / typing_min_ms 等) は、対応する enable flag が
 *     true のときに参照される。null の場合はモジュール内の固定デフォルトを使う
 *     (= 旧 envConfig fallback の代わり)。
 *   - **作品単位の設定 (旧 workConfig) には fallback しない**。
 *   - **環境変数の enable 系には fallback しない** (= READ_RECEIPT_ENABLED / TYPING_ENABLED 等)。
 *     ※ `ReadReceiptController.config.enabled` は別系統の master-switch として残置 (= 後述)。
 *
 * 後方互換のため第 2 / 第 3 引数は受け付けるが、内部では完全に無視する。
 * 旧シグネチャの呼び出し元 (= webhook 等) を壊さないため。
 */
export function resolveMessageTimingConfig(
  msgConfig: MessageTimingConfig | null | undefined,
  _legacyWorkConfig?: MessageTimingConfig | null,
  _legacyEnvConfig?: ReadReceiptConfig,
): ResolvedTimingConfig {
  // 既読モード: msg 値が "immediate" / "delayed" / "before_reply" のときのみ採用、
  // それ以外 (= null / undefined / "inherit") は OFF 相当の "immediate" に正規化。
  const msgMode = msgConfig?.read_receipt_mode;
  const readReceiptMode: ResolvedTimingConfig["readReceiptMode"] =
    (msgMode === "immediate" || msgMode === "delayed" || msgMode === "before_reply")
      ? msgMode
      : "immediate";

  return {
    readReceiptMode,
    // 数値フィールドは enable flag が ON のときに参照される。null は固定デフォルトへ。
    readDelayMs:        msgConfig?.read_delay_ms        ?? DEFAULT_READ_DELAY_MS,
    typingEnabled:      msgConfig?.typing_enabled       ?? false,
    typingMinMs:        msgConfig?.typing_min_ms        ?? DEFAULT_TYPING_MIN_MS,
    typingMaxMs:        msgConfig?.typing_max_ms        ?? DEFAULT_TYPING_MAX_MS,
    loadingEnabled:     msgConfig?.loading_enabled      ?? false,
    loadingThresholdMs: msgConfig?.loading_threshold_ms ?? DEFAULT_LOADING_THRESHOLD_MS,
    loadingMinSeconds:  msgConfig?.loading_min_seconds  ?? DEFAULT_LOADING_MIN_SECONDS,
    loadingMaxSeconds:  msgConfig?.loading_max_seconds  ?? DEFAULT_LOADING_MAX_SECONDS,
  };
}

// ────────────────────────────────────────────────
// ローディング秒数の動的算出
// ────────────────────────────────────────────────

/**
 * LINE Loading Animation API が受け付ける loadingSeconds に丸める。
 *
 * LINE 仕様:
 *   - 値は 5 の倍数（5, 10, 15, …, 60）のみ有効
 *   - 最小 5 / 最大 60
 *
 * 丸めルール:
 *   - 5 の倍数へ「切り上げ」（1〜4 → 5 / 6〜10 → 10 / 11〜15 → 15 …）
 *   - 5〜60 にクランプ（60 超 → 60）
 *   - 未設定 / NaN / Infinity / 非数値 → 5（安全側）
 */
export function normalizeLoadingSeconds(seconds: number | null | undefined): number {
  if (seconds == null || !Number.isFinite(seconds)) return 5;
  const stepped = Math.ceil(seconds / 5) * 5;
  return Math.max(5, Math.min(60, stepped));
}

/**
 * ローディングアニメーションに渡す loadingSeconds を「CMS設定秒」から算出する。
 *
 * 方針（経過×1.5 ヒューリスティックは廃止）:
 *   - 実際の表示時間は「CMS設定秒だけ待ってからメッセージを送る」ことで制御する。
 *     loadingSeconds 自体は LINE 仕様（メッセージ到着で自動消滅）上、表示長を直接決めない。
 *   - よって loadingSeconds は CMS 設定秒（max 優先・min 下限）を 5 刻みへ切り上げた値にする。
 *     例: CMS 3 → 5 / CMS 8 → 10 / CMS 11 → 15。
 *   - 第1引数 elapsedMs は後方互換のため受けるが使用しない。
 */
export function computeLoadingSeconds(
  _elapsedMs: number,
  minSeconds: number,
  maxSeconds: number,
): number {
  const cmsSeconds = Math.max(minSeconds, maxSeconds);
  // LINE API 制約: 5〜60 / 5 刻みへ切り上げ。
  return normalizeLoadingSeconds(cmsSeconds);
}

/**
 * CMS の「入力中…」設定から、送信直前に適用する loading の実行プランを解決する。
 *
 *   - `loading_enabled !== true` → null（loading も待機も出さない＝即送信）。
 *   - 有効時: 実待機 ms（= CMS 設定秒）と LINE loadingSeconds（5 刻み切り上げ）を返す。
 *     表示時間は delayMs 後にメッセージを送る（到着で loading 消滅）ことで CMS 設定秒に近づく。
 *
 * CMS 設定秒は「最大秒数」を優先（無ければ最小秒数、どちらも無ければ既定 5 秒）。
 */
export function resolveCmsLoadingPlan(
  timing: MessageTimingConfig | null | undefined,
): { delayMs: number; loadingSeconds: number; cmsSeconds: number } | null {
  if (timing?.loading_enabled !== true) return null;
  const raw = timing.loading_max_seconds ?? timing.loading_min_seconds ?? DEFAULT_LOADING_MIN_SECONDS;
  const cmsSeconds = Math.max(1, Math.min(60, Number.isFinite(raw) ? (raw as number) : DEFAULT_LOADING_MIN_SECONDS));
  return { delayMs: cmsSeconds * 1000, loadingSeconds: normalizeLoadingSeconds(cmsSeconds), cmsSeconds };
}

// ────────────────────────────────────────────────
// 低レベル API 呼び出し
// ────────────────────────────────────────────────

export async function markAsRead(
  markAsReadToken: string,
  channelAccessToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(LINE_MARK_AS_READ_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ markAsReadToken }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(読み取り不能)");
      console.error(`[markAsRead] HTTP ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[markAsRead] ネットワークエラー:", err);
    return false;
  }
}

/** userId を安全にマスクする（全文・PII を出さない。先頭 8 文字 + 長さのみ）。 */
function maskUserId(userId: string | null | undefined): string {
  if (!userId) return "(none)";
  return `${userId.slice(0, 8)}…(${userId.length})`;
}

/** ローディング失敗ログに付与する任意のコンテキスト（PII・トークンは含めない）。 */
export type LoadingLogContext = {
  oaId?:      string | null;
  workId?:    string | null;
  messageId?: string | null;
};

/**
 * LINE Loading Animation を表示する。
 *
 * - loadingSeconds は normalizeLoadingSeconds で LINE 有効値（5〜60・5刻み）へ丸める。
 * - 失敗してもメッセージ送信は止めない（呼び出し側は戻り値 false を無視してよい）。
 *   ただし切り分け用に **warning** で構造化ログを残す（PII・本文・トークンは出さない）。
 */
export async function showLoadingAnimation(
  chatId: string,
  loadingSeconds: number,
  channelAccessToken: string,
  logContext?: LoadingLogContext,
): Promise<boolean> {
  const requestedSeconds  = loadingSeconds;
  const normalizedSeconds = normalizeLoadingSeconds(loadingSeconds);
  const baseLog = {
    oaId:              logContext?.oaId ?? null,
    workId:            logContext?.workId ?? null,
    messageId:         logContext?.messageId ?? null,
    userIdMasked:      maskUserId(chatId),
    requestedSeconds,
    normalizedSeconds,
  };
  try {
    const res = await fetch(LINE_LOADING_START_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chatId,
        loadingSeconds: normalizedSeconds,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(読み取り不能)");
      // 送信は止めない。warning で可視化（body は安全な範囲に切り詰める）。
      console.warn("[line:loading:failed]", JSON.stringify({
        ...baseLog,
        status: res.status,
        body:   body.slice(0, 300),
      }));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[line:loading:failed]", JSON.stringify({
      ...baseLog,
      status:       null,
      errorName:    err instanceof Error ? err.name : "Unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    }));
    return false;
  }
}

// ────────────────────────────────────────────────
// ReadReceiptController
// ────────────────────────────────────────────────

/** タイミングログ（構造化ログ出力用） */
export type TimingLog = {
  receivedAt:              number;
  readMarkScheduledAt:     number | null;
  readMarkSentAt:          number | null;
  typingScheduledAt:       number | null;
  typingStartedAt:         number | null;
  typingWaitMs:            number | null;
  loadingStartedAt:        number | null;
  loadingSecondsComputed:  number | null;
  replySentAt:             number | null;
  totalMs:                 number | null;
};

export class ReadReceiptController {
  private readonly config: ReadReceiptConfig;
  private readonly markAsReadToken: string | undefined;
  private readonly userId: string;
  private readonly channelAccessToken: string;
  private readonly isOneOnOne: boolean;
  // ローディング失敗ログ用の任意コンテキスト（PII・トークンは含めない）。
  private readonly oaId: string | null;
  private readonly workId: string | null;

  // 演出設定（メッセージ単位のみ。作品単位の参照は廃止 = 継承モード撤廃）
  private resolvedTiming: ResolvedTimingConfig | null = null;

  // タイミング
  private readonly receivedAt: number;
  private readMarkScheduledAt: number | null = null;
  private readMarkSentAt: number | null = null;
  private typingScheduledAt: number | null = null;
  private typingStartedAt: number | null = null;
  private typingWaitMs: number | null = null;
  private loadingStartedAt: number | null = null;
  private loadingSecondsComputed: number | null = null;
  private replySentAt: number | null = null;

  // 状態
  private readSent = false;
  private readTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingShown = false;
  // Phase 2c hotfix: chain 送信に入る直前に scheduled loading を抑止するための内部 signal
  private loadingAbortInternal = new AbortController();

  constructor(opts: {
    markAsReadToken?: string;
    userId: string;
    channelAccessToken: string;
    isOneOnOne: boolean;
    config?: Partial<ReadReceiptConfig>;
    receivedAt?: number;
    /** ローディング失敗ログ用（任意）。 */
    oaId?: string | null;
    workId?: string | null;
  }) {
    this.config = getConfig(opts.config);
    this.markAsReadToken = opts.markAsReadToken;
    this.userId = opts.userId;
    this.channelAccessToken = opts.channelAccessToken;
    this.isOneOnOne = opts.isOneOnOne;
    this.receivedAt = opts.receivedAt ?? Date.now();
    this.oaId = opts.oaId ?? null;
    this.workId = opts.workId ?? null;
  }

  /** 1:1 トークか（loading animation は 1:1 のみ対象。group/room では呼ばない判定に使う）。 */
  get isOneToOne(): boolean {
    return this.isOneOnOne;
  }

  /**
   * @deprecated 継承モード廃止により no-op。後方互換のためシグネチャだけ残してある。
   * 呼び出し元 (webhook) は影響なく動作する。
   */
  setWorkTiming(_workConfig: MessageTimingConfig | null | undefined): void {
    // intentionally empty: work 単位の演出デフォルトは参照しない。
  }

  /**
   * メッセージ単位の演出設定を適用する。
   * 返信メッセージが確定した後に呼ぶことで、以降の typing / loading 判定に反映される。
   * null / "inherit" は OFF として正規化される。
   */
  applyMessageTiming(msgConfig: MessageTimingConfig | null | undefined): void {
    this.resolvedTiming = resolveMessageTimingConfig(msgConfig);
  }

  /** 現在有効な解決済み設定を返す。未適用なら null から resolve した OFF 状態を返す。 */
  private getResolved(): ResolvedTimingConfig {
    return this.resolvedTiming ?? resolveMessageTimingConfig(null);
  }

  // ── 既読遅延スケジュール ──

  scheduleDelayedRead(): void {
    if (!this.config.enabled || !this.markAsReadToken) return;

    this.readMarkScheduledAt = Date.now();
    const delay = this.config.readDelayMs;

    if (delay <= 0) {
      void this.sendRead();
      return;
    }

    this.readTimer = setTimeout(() => {
      void this.sendRead();
    }, delay);
  }

  async ensureReadBeforeReply(): Promise<void> {
    if (!this.config.enabled || !this.markAsReadToken) return;
    if (this.readSent) return;

    if (this.readTimer) {
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }

    await this.sendRead();
  }

  private async sendRead(): Promise<void> {
    if (this.readSent || !this.markAsReadToken) return;
    this.readSent = true;
    this.readMarkSentAt = Date.now();
    await markAsRead(this.markAsReadToken, this.channelAccessToken);
  }

  // ── typing 風待機 ──

  /**
   * 返信前に「考えている風の間」を入れる。
   *
   * - typing が無効 or 全体処理が既に十分長い場合はスキップ
   * - 既読が未送信なら先に送信してから待機する
   * - 待機時間 = typingMinMs〜typingMaxMs のランダム値（ただし既経過時間を考慮して短縮）
   */
  async waitTypingBeforeReply(): Promise<void> {
    const resolved = this.getResolved();
    if (!resolved.typingEnabled) return;

    const elapsed = Date.now() - this.receivedAt;

    // 処理が loadingThresholdMs を超えている場合、ユーザーは既に十分待っている → typing 不要
    if (elapsed >= resolved.loadingThresholdMs) return;

    // typing 待機時間を算出
    const range = resolved.typingMaxMs - resolved.typingMinMs;
    const rawWait = resolved.typingMinMs + Math.random() * range;

    // 全体の経過時間を考慮して短縮:
    // 既に 1 秒待っていたら、追加 typing は控えめにする
    const maxAdditionalWait = Math.max(0, resolved.loadingThresholdMs - elapsed - 500);
    const actualWait = Math.round(Math.min(rawWait, maxAdditionalWait));

    if (actualWait <= 50) return; // 50ms 以下は無意味なのでスキップ

    this.typingScheduledAt = Date.now();

    // typing 開始前に既読を送る（未読→考え中 に見せるため）
    await this.ensureReadBeforeReply();

    this.typingStartedAt = Date.now();
    this.typingWaitMs = actualWait;
    await sleep(actualWait);
  }

  /**
   * Phase 2c: chain 内 2 通目以降の per-message typing 待機。
   *
   * receivedAt からの経過時間を参照しない (= waitTypingBeforeReply とは別物)。
   * 1 通目を送った直後など、既に loadingThresholdMs を超えている場合でも
   * メッセージ作者が設定した「次の発話前の typing」をそのまま効かせるための入口。
   *
   * - 解決済み timing が typingEnabled=false なら即 return
   * - typingMinMs〜typingMaxMs のランダム値で sleep
   * - 50ms 以下は意味がないのでスキップ
   *
   * loading / 既読 (delayed read) には触らない (= chain head の枠組みで処理済み)。
   *
   * @param msgConfig 当該メッセージの timing 設定 (= LineMessage._timing)
   */
  async waitTypingForMessage(msgConfig: MessageTimingConfig | null | undefined): Promise<void> {
    const resolved = resolveMessageTimingConfig(msgConfig);
    if (!resolved.typingEnabled) return;

    const minMs = Math.max(0, resolved.typingMinMs);
    const maxMs = Math.max(minMs, resolved.typingMaxMs);
    const rawWait = minMs + Math.random() * (maxMs - minMs);
    const actualWait = Math.round(rawWait);
    if (actualWait <= 50) return;

    await sleep(actualWait);
  }

  // ── ローディングアニメーション（可変秒数）──

  scheduleLoading(signal?: AbortSignal): void {
    const resolved = this.getResolved();
    if (!resolved.loadingEnabled || !this.isOneOnOne || this.loadingShown) return;

    const remaining = resolved.loadingThresholdMs - (Date.now() - this.receivedAt);
    if (remaining <= 0) {
      if (this.loadingAbortInternal.signal.aborted) return;
      void this.showLoadingNow();
      return;
    }

    const timer = setTimeout(() => {
      if (signal?.aborted || this.loadingAbortInternal.signal.aborted) return;
      void this.showLoadingNow();
    }, remaining);

    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
    this.loadingAbortInternal.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  }

  /**
   * Phase 2c hotfix: scheduled な loading を抑止する。
   *
   * 用途: chain 送信 (= msg2 以降の push) に入る直前に呼ぶことで、
   *       webhook 開始時に予約された loading が msg1/msg2 の間に
   *       割り込み表示されるのを防ぐ。
   *
   * 既に発火済みの loading は止められない (= LINE API への 1 回の call は取り消せない)。
   * 未発火の setTimeout だけクリアする。
   *
   * 1 通メッセージ送信時は呼ばない (= 従来通り webhook-level scheduleLoading が動く)。
   */
  abortPendingLoading(): void {
    this.loadingAbortInternal.abort();
  }

  /**
   * Phase 2c hotfix: 指定 message の timing に基づいて loading を即時表示する。
   *
   * - msgConfig.loading_enabled が true (= 明示 ON) のときだけ表示する。
   * - 1:1 トーク (isOneOnOne) でなければスキップ。
   * - **loadingShown guard は効かせない** (= per-message loading は LINE 側で
   *   重複呼び出しを許容するため、各 message の前に refresh を試みる)。
   *
   * 用途: chain push loop で msg2 等を送る直前に「このメッセージは loading 出す」
   *       設定なら明示的に発火する。LINE 側が表示できれば見える、できなくても害はない (= best-effort)。
   *
   * 参考: LINE LoadingAnimation API は同じ chat に対する複数回呼び出しを許容し、
   * 後発の呼び出しが loading の duration を更新する (= 再表示開始扱い)。
   * よって msg1 の loading が表示中でも msg2 で呼ぶことで refresh を試みる。
   */
  async showLoadingForMessage(
    msgConfig: MessageTimingConfig | null | undefined,
    logMeta?: { messageId?: string | null },
  ): Promise<void> {
    if (!msgConfig?.loading_enabled) return;
    if (!this.isOneOnOne) return;

    // 入力中設定があるのに userId が取れない場合は表示できない。warning で可視化する
    // (= 全文 userId・トークンは出さない)。送信自体は呼び出し側で継続される。
    if (!this.userId) {
      console.warn("[line:loading:skipped]", JSON.stringify({
        reason:    "missing_user_id",
        oaId:      this.oaId,
        workId:    this.workId,
        messageId: logMeta?.messageId ?? null,
      }));
      return;
    }

    // loadingShown guard を意図的にスキップ。LINE API への重複呼び出しは
    // best-effort で許容する (= 「入力中...」表示の per-message refresh を試みる)。
    const resolved = resolveMessageTimingConfig(msgConfig);
    const elapsed = Date.now() - this.receivedAt;
    const seconds = computeLoadingSeconds(elapsed, resolved.loadingMinSeconds, resolved.loadingMaxSeconds);
    this.loadingShown = true;  // 統計用 (= legacy scheduleLoading の二重発火は防止)
    this.loadingStartedAt = Date.now();
    this.loadingSecondsComputed = seconds;
    await showLoadingAnimation(this.userId, seconds, this.channelAccessToken, {
      oaId:      this.oaId,
      workId:    this.workId,
      messageId: logMeta?.messageId ?? null,
    });
  }

  /** @deprecated checkAndShowLoading を使う代わりに scheduleLoading を推奨 */
  async checkAndShowLoading(): Promise<void> {
    const resolved = this.getResolved();
    if (!resolved.loadingEnabled || !this.isOneOnOne || this.loadingShown) return;

    const elapsed = Date.now() - this.receivedAt;
    if (elapsed < resolved.loadingThresholdMs) return;

    await this.showLoadingNow();
  }

  private async showLoadingNow(): Promise<void> {
    if (this.loadingShown) return;
    this.loadingShown = true;
    this.loadingStartedAt = Date.now();

    const resolved = this.getResolved();
    const elapsed = Date.now() - this.receivedAt;
    const seconds = computeLoadingSeconds(elapsed, resolved.loadingMinSeconds, resolved.loadingMaxSeconds);
    this.loadingSecondsComputed = seconds;

    await showLoadingAnimation(this.userId, seconds, this.channelAccessToken, {
      oaId:   this.oaId,
      workId: this.workId,
    });
  }

  // ── タイミングログ ──

  markReplySent(): void {
    this.replySentAt = Date.now();
  }

  getTimingLog(): TimingLog {
    return {
      receivedAt:             this.receivedAt,
      readMarkScheduledAt:    this.readMarkScheduledAt,
      readMarkSentAt:         this.readMarkSentAt,
      typingScheduledAt:      this.typingScheduledAt,
      typingStartedAt:        this.typingStartedAt,
      typingWaitMs:           this.typingWaitMs,
      loadingStartedAt:       this.loadingStartedAt,
      loadingSecondsComputed: this.loadingSecondsComputed,
      replySentAt:            this.replySentAt,
      totalMs:                this.replySentAt ? this.replySentAt - this.receivedAt : null,
    };
  }

  logTiming(label: string): void {
    const log = this.getTimingLog();
    const fmt = (ts: number | null) => ts ? `+${ts - this.receivedAt}ms` : "-";
    console.log(
      `[timing][${label}]`,
      `total=${log.totalMs ?? "-"}ms`,
      `read_sched=${fmt(log.readMarkScheduledAt)}`,
      `read_sent=${fmt(log.readMarkSentAt)}`,
      `typing=${log.typingWaitMs != null ? `${log.typingWaitMs}ms@${fmt(log.typingStartedAt)}` : "-"}`,
      `loading=${fmt(log.loadingStartedAt)}${log.loadingSecondsComputed != null ? `(${log.loadingSecondsComputed}s)` : ""}`,
      `reply=${fmt(log.replySentAt)}`,
    );
  }

  // ── クリーンアップ ──

  dispose(): void {
    if (this.readTimer) {
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }
  }
}
