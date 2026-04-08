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
 * メッセージ単位 → 作品単位 → 環境変数デフォルト の優先順位で解決する。
 *
 * 各フィールドは null = inherit として上位に委譲。
 * ?? チェーンにより message > work > env の順で最初の非 null 値を採用する。
 *
 * @param msgConfig   メッセージ単位の設定（DB 保存値。null/undefined=inherit）
 * @param workConfig  作品単位の設定（DB 保存値。null/undefined=inherit）
 * @param envConfig   環境変数ベースの設定（getConfig() の戻り値）
 */
export function resolveMessageTimingConfig(
  msgConfig: MessageTimingConfig | null | undefined,
  workConfig: MessageTimingConfig | null | undefined = null,
  envConfig: ReadReceiptConfig = globalConfig,
): ResolvedTimingConfig {
  // readReceiptMode の解決: message > work > env
  const msgMode  = msgConfig?.read_receipt_mode;
  const workMode = workConfig?.read_receipt_mode;
  let readReceiptMode: ResolvedTimingConfig["readReceiptMode"];
  if (msgMode && msgMode !== "inherit") {
    readReceiptMode = msgMode;
  } else if (workMode && workMode !== "inherit") {
    readReceiptMode = workMode;
  } else {
    readReceiptMode = envConfig.enabled ? "delayed" : "immediate";
  }

  return {
    readReceiptMode,
    readDelayMs:        msgConfig?.read_delay_ms        ?? workConfig?.read_delay_ms        ?? envConfig.readDelayMs,
    typingEnabled:      msgConfig?.typing_enabled       ?? workConfig?.typing_enabled       ?? envConfig.typingEnabled,
    typingMinMs:        msgConfig?.typing_min_ms        ?? workConfig?.typing_min_ms        ?? envConfig.typingMinMs,
    typingMaxMs:        msgConfig?.typing_max_ms        ?? workConfig?.typing_max_ms        ?? envConfig.typingMaxMs,
    loadingEnabled:     msgConfig?.loading_enabled      ?? workConfig?.loading_enabled      ?? envConfig.loadingEnabled,
    loadingThresholdMs: msgConfig?.loading_threshold_ms ?? workConfig?.loading_threshold_ms ?? envConfig.loadingThresholdMs,
    loadingMinSeconds:  msgConfig?.loading_min_seconds  ?? workConfig?.loading_min_seconds  ?? envConfig.loadingMinSeconds,
    loadingMaxSeconds:  msgConfig?.loading_max_seconds  ?? workConfig?.loading_max_seconds  ?? envConfig.loadingMaxSeconds,
  };
}

// ────────────────────────────────────────────────
// ローディング秒数の動的算出
// ────────────────────────────────────────────────

/**
 * 経過時間を元にローディングアニメーションの秒数を算出する。
 *
 * 考え方:
 *   - 既に elapsed ms 経過しているため、残り待ち時間の見込みから自然な秒数を決める
 *   - min / max の範囲にクランプ
 *   - LINE API は 5〜60 秒のみ受け付ける
 */
export function computeLoadingSeconds(
  elapsedMs: number,
  minSeconds: number,
  maxSeconds: number,
): number {
  // 基本: 経過時間の 1.5 倍の残りを見込む（ヒューリスティック）
  const estimatedRemainingSec = Math.ceil((elapsedMs * 1.5) / 1000);
  const clamped = Math.max(minSeconds, Math.min(maxSeconds, estimatedRemainingSec));
  // LINE API 制約: 5〜60
  return Math.max(5, Math.min(60, clamped));
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

export async function showLoadingAnimation(
  chatId: string,
  loadingSeconds: number,
  channelAccessToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(LINE_LOADING_START_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chatId,
        loadingSeconds: Math.max(5, Math.min(60, loadingSeconds)),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(読み取り不能)");
      console.error(`[showLoadingAnimation] HTTP ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[showLoadingAnimation] ネットワークエラー:", err);
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

  // 演出設定（メッセージ単位/作品単位で上書き可能）
  private resolvedTiming: ResolvedTimingConfig | null = null;
  private workTiming: MessageTimingConfig | null = null;

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

  constructor(opts: {
    markAsReadToken?: string;
    userId: string;
    channelAccessToken: string;
    isOneOnOne: boolean;
    config?: Partial<ReadReceiptConfig>;
    receivedAt?: number;
  }) {
    this.config = getConfig(opts.config);
    this.markAsReadToken = opts.markAsReadToken;
    this.userId = opts.userId;
    this.channelAccessToken = opts.channelAccessToken;
    this.isOneOnOne = opts.isOneOnOne;
    this.receivedAt = opts.receivedAt ?? Date.now();
  }

  /**
   * 作品単位の演出設定をセットする。
   * Webhook で Work 取得後に一度だけ呼ぶ。以降の resolve に反映される。
   */
  setWorkTiming(workConfig: MessageTimingConfig | null | undefined): void {
    this.workTiming = workConfig ?? null;
  }

  /**
   * メッセージ単位の演出設定を適用する。
   * 返信するメッセージが確定した後に呼ぶことで、以降の typing / loading 判定に反映される。
   * 優先順位: message > work > env
   */
  applyMessageTiming(msgConfig: MessageTimingConfig | null | undefined): void {
    this.resolvedTiming = resolveMessageTimingConfig(msgConfig, this.workTiming, this.config);
  }

  /** 現在有効な解決済み設定を返す */
  private getResolved(): ResolvedTimingConfig {
    return this.resolvedTiming ?? resolveMessageTimingConfig(null, this.workTiming, this.config);
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

  // ── ローディングアニメーション（可変秒数）──

  scheduleLoading(signal?: AbortSignal): void {
    const resolved = this.getResolved();
    if (!resolved.loadingEnabled || !this.isOneOnOne || this.loadingShown) return;

    const remaining = resolved.loadingThresholdMs - (Date.now() - this.receivedAt);
    if (remaining <= 0) {
      void this.showLoadingNow();
      return;
    }

    const timer = setTimeout(() => {
      if (signal?.aborted) return;
      void this.showLoadingNow();
    }, remaining);

    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
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

    await showLoadingAnimation(this.userId, seconds, this.channelAccessToken);
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
