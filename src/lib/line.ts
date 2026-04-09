// src/lib/line.ts
// LINE Messaging API ヘルパー
//
// 責務:
//   - X-Line-Signature 検証（HMAC-SHA256）
//   - Reply API 呼び出し
//   - RuntimePhase → LINE メッセージ変換

import crypto from "crypto";
import type { RuntimePhase, QuickReplyItem } from "@/types";

// ────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────

/** LINE sender — キャラクターの吹き出し送信者情報 */
export type LineSender = {
  /** 表示名（最大 20 文字） */
  name?: string;
  /** アイコン画像 URL（HTTPS 必須・正方形推奨） */
  iconUrl?: string;
};

/** LINE クイックリプライ アクション */
export type LineQuickReplyItem = {
  type: "action";
  action:
    | {
        type:  "message";
        /** ボタン表示テキスト（最大 20 文字） */
        label: string;
        /** タップ時に送信するテキスト */
        text:  string;
      }
    | {
        type:  "uri";
        label: string;
        uri:   string;
      }
    | {
        type:         "postback";
        label:        string;
        /** postback.data として渡す文字列（最大 300 文字） */
        data:         string;
        /** タップ時にトーク画面に表示するテキスト（任意） */
        displayText?: string;
      };
};

/** LINE クイックリプライ */
export type LineQuickReply = {
  items: LineQuickReplyItem[];
};

export type LineTextMessage = {
  type: "text";
  text: string;
  /** キャラクター送信者情報（任意） */
  sender?: LineSender;
  /** クイックリプライ選択肢（任意） */
  quickReply?: LineQuickReply;
  /** @internal LINE API には送信しない。replyWithLagToLine のラグ制御に使用（ms） */
  _lagMs?: number;
};

export type LineImageMessage = {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
  /** キャラクター送信者情報（任意） */
  sender?: LineSender;
  /** クイックリプライ選択肢（任意） */
  quickReply?: LineQuickReply;
  /** @internal LINE API には送信しない。replyWithLagToLine のラグ制御に使用（ms） */
  _lagMs?: number;
};

export type LineVideoMessage = {
  type: "video";
  originalContentUrl: string;
  previewImageUrl: string;
  /** キャラクター送信者情報（任意） */
  sender?: LineSender;
  /** クイックリプライ選択肢（任意） */
  quickReply?: LineQuickReply;
  /** @internal LINE API には送信しない。replyWithLagToLine のラグ制御に使用（ms） */
  _lagMs?: number;
};

export type LineMessage = LineTextMessage | LineImageMessage | LineVideoMessage;

// LINE Webhook イベント（最小限の型定義）
export type LineEvent = {
  type: string;
  mode: string;
  timestamp: number;
  replyToken?: string;
  source: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: string;
    text?: string;
  };
  /** postback イベントのデータ */
  postback?: {
    data: string;
    params?: Record<string, string>;
  };
  /** 既読制御トークン（Mark as Read API で使用）。メッセージイベントに付与される */
  markAsReadToken?: string;
};

export type LineWebhookBody = {
  destination: string;
  events: LineEvent[];
};

// ────────────────────────────────────────────────
// プレースホルダ置換
// ────────────────────────────────────────────────

/** メッセージ本文に埋め込むプレースホルダ変数 */
export type PlaceholderVars = {
  /** LINE ユーザーの表示名（プロフィール displayName） */
  userName?:    string;
  /** LINE 公式アカウント名（OA タイトル） */
  accountName?: string;
};

/**
 * テキスト内の `{{user_name}}` / `{{account_name}}` を実際の値へ置換する。
 * 値が未設定（undefined）の場合は空文字へ置換し、プレースホルダ文字列が露出しないようにする。
 */
export function replacePlaceholders(text: string, vars: PlaceholderVars): string {
  return text
    .replace(/\{\{user_name\}\}/g,    vars.userName    ?? "")
    .replace(/\{\{account_name\}\}/g, vars.accountName ?? "");
}

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────

const LINE_REPLY_URL     = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL      = "https://api.line.me/v2/bot/message/push";
const LINE_TEXT_MAX      = 5000; // LINE テキストメッセージの最大文字数
const LINE_MSG_MAX       = 5;    // 1 回の reply で送れる最大メッセージ数
const DEFAULT_MSG_LAG_MS = 1000; // lag_ms 未設定時のメッセージ間待機時間（ms）
const MAX_MSG_LAG_MS     = 2000; // lag_ms の上限値（ms）

/** ms ミリ秒待機する */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ────────────────────────────────────────────────
// メッセージ変換共通ヘルパー
// ────────────────────────────────────────────────
//
// buildPhaseMessages / buildKeywordMessages が共有する
// 「message_type → LineMessage」変換の単一実装。
// 変換契約を1箇所に集約し、未対応型の黙殺を防止する。
//
// 変換契約:
//   正式対応（専用 LINE 型に変換）:
//     text      → LineTextMessage   （body 必須）
//     image     → LineImageMessage  （asset_url 必須）
//     video     → LineVideoMessage  （asset_url 必須）
//   フォールバック（text 代替送信）:
//     flex / carousel / voice / riddle / 未知型
//     → alt_text or body をテキスト送信。carousel の body は JSON の可能性があるため alt_text 優先。
//   欠損時:
//     正式対応型で必須フィールドが null → warn + null（スキップ）
//     フォールバック候補もすべて null   → warn("変換不能") + null

/** convertMessageToLine に渡す共通入力型 */
type ConvertibleMessage = {
  id:         string;
  /** DB の kind カラム値。"normal" | "start" | "puzzle" | "response" | "hint" */
  kind?:      string;
  /** DB の messageType カラム値。text / image / video / carousel / voice / riddle / flex / 任意 */
  mtype:      string;
  body:       string | null;
  asset_url:  string | null;
  alt_text:   string | null;
  sender?:    LineSender;
  quickReply?: LineQuickReply;
  lagMs?:     number;
};

/**
 * 単一メッセージを LineMessage に変換する。
 * 変換不能な場合は null を返し、呼び出し元がスキップする。
 *
 * @param msg     変換対象
 * @param caller  ログ出力用の呼び出し元名（"buildPhaseMessages" など）
 * @param phaseId ログ出力用のフェーズ ID（任意）
 * @param vars    プレースホルダ置換変数
 */
function convertMessageToLine(
  msg:     ConvertibleMessage,
  caller:  string,
  phaseId: string,
  vars:    PlaceholderVars = {},
): LineMessage | null {
  const { id, kind, mtype, body, asset_url, alt_text, sender, quickReply, lagMs } = msg;
  const isPuzzle = kind === "puzzle";

  /** LINE メッセージ共通フィールドを付与するヘルパー */
  const attach = <T extends LineMessage>(m: T): T => {
    if (sender) m.sender = sender;
    if (quickReply) m.quickReply = quickReply;
    if (lagMs && lagMs > 0) m._lagMs = lagMs;
    return m;
  };

  // ── 正式対応 ──
  if (mtype === "text") {
    if (body) return attach({ type: "text", text: replacePlaceholders(body, vars) } as LineTextMessage);
    // puzzle の text で body が空 → フォールバックテキストで送信
    if (isPuzzle) {
      const fb = alt_text || "この謎を解いてください";
      console.warn(`[${caller}] puzzle body が空のためフォールバック送信 id=${id.slice(0, 8)} fallback="${fb.slice(0, 30)}"`);
      return attach({ type: "text", text: replacePlaceholders(fb, vars) } as LineTextMessage);
    }
    console.warn(`[${caller}] ⚠️ text メッセージの body が空 id=${id.slice(0, 8)} phase=${phaseId.slice(0, 8)}`);
    return null;
  }
  if (mtype === "image") {
    if (asset_url) return attach({ type: "image", originalContentUrl: asset_url, previewImageUrl: asset_url } as LineImageMessage);
    // puzzle の image で asset_url が空 → body or alt_text をテキストフォールバック
    if (isPuzzle) {
      const fb = body || alt_text || "この謎を解いてください";
      console.warn(`[${caller}] puzzle image の asset_url が空のためテキストフォールバック送信 id=${id.slice(0, 8)}`);
      return attach({ type: "text", text: replacePlaceholders(fb, vars) } as LineTextMessage);
    }
    console.warn(`[${caller}] ⚠️ image メッセージの asset_url が空 id=${id.slice(0, 8)} phase=${phaseId.slice(0, 8)}`);
    return null;
  }
  if (mtype === "video") {
    if (asset_url) return attach({ type: "video", originalContentUrl: asset_url, previewImageUrl: asset_url } as LineVideoMessage);
    // puzzle の video で asset_url が空 → body or alt_text をテキストフォールバック
    if (isPuzzle) {
      const fb = body || alt_text || "この謎を解いてください";
      console.warn(`[${caller}] puzzle video の asset_url が空のためテキストフォールバック送信 id=${id.slice(0, 8)}`);
      return attach({ type: "text", text: replacePlaceholders(fb, vars) } as LineTextMessage);
    }
    console.warn(`[${caller}] ⚠️ video メッセージの asset_url が空 id=${id.slice(0, 8)} phase=${phaseId.slice(0, 8)}`);
    return null;
  }

  // ── フォールバック（carousel / voice / riddle / flex / 未知型）──
  const fallbackText = (mtype === "carousel" && alt_text) ? alt_text : (alt_text || body);
  if (fallbackText) {
    return attach({ type: "text", text: replacePlaceholders(truncateText(fallbackText), vars) } as LineTextMessage);
  }

  // puzzle の未知型でもフォールバック送信
  if (isPuzzle) {
    const fb = "この謎を解いてください";
    console.warn(`[${caller}] puzzle 変換不能のためフォールバック送信 id=${id.slice(0, 8)} type=${mtype}`);
    return attach({ type: "text", text: fb } as LineTextMessage);
  }

  // ── 変換不能 ──
  console.warn(
    `[${caller}] ⚠️ 変換不能メッセージ（送信スキップ）`,
    `id=${id.slice(0, 8)} type=${mtype} kind=${kind ?? "unknown"} phase=${phaseId.slice(0, 8)}`,
    `body=${body ? "あり" : "なし"} asset=${asset_url ? "あり" : "なし"} alt=${alt_text ? "あり" : "なし"}`,
  );
  return null;
}

/**
 * 変換結果のサマリログを出力する。
 * 入力に対して出力が減った場合に warn、0件になった場合に error を出す。
 */
function logConversionSummary(caller: string, phaseId: string, inputCount: number, outputCount: number): void {
  if (inputCount > 0 && outputCount === 0) {
    console.error(`[${caller}] ❌ 入力 ${inputCount}件 → LINE変換 0件（全メッセージが変換不能） phase=${phaseId.slice(0, 8)}`);
  } else if (inputCount > 0 && outputCount < inputCount) {
    console.warn(`[${caller}] 入力 ${inputCount}件 → LINE変換 ${outputCount}件（${inputCount - outputCount}件スキップ） phase=${phaseId.slice(0, 8)}`);
  }
}

/** LineMessage から内部フィールド（_lagMs）を除去して送信用オブジェクトを生成する */
function stripInternalFields(msg: LineMessage): Record<string, unknown> {
  const m = { ...msg } as Record<string, unknown>;
  delete m._lagMs;
  return m;
}

/** 「はじめる」に準じる（再）開始コマンド */
const START_KEYWORDS = new Set([
  "はじめる", "始める", "スタート", "start", "開始",
]);

/** 「最初から」リセット系コマンド */
const RESET_KEYWORDS = new Set([
  "リセット", "最初から", "restart", "reset",
]);

/** 「つづきから」現在状態確認コマンド */
const CONTINUE_KEYWORDS = new Set([
  "つづきから", "続きから", "つづき", "continue", "現在",
]);

// ────────────────────────────────────────────────
// リッチメニュー アクションコード
// ────────────────────────────────────────────────

/** リッチメニューの postback.data として使うアクション定数 */
export const RICHMENU_ACTIONS = {
  START:    "ACTION:START",
  CONTINUE: "ACTION:CONTINUE",
  RESET:    "ACTION:RESET",
} as const;

export type RichMenuAction = typeof RICHMENU_ACTIONS[keyof typeof RICHMENU_ACTIONS];

// ────────────────────────────────────────────────
// 署名検証
// ────────────────────────────────────────────────

/**
 * LINE から届いたリクエストの署名を検証する。
 * @param rawBody  リクエストの生ボディ（文字列）
 * @param signature `X-Line-Signature` ヘッダーの値（Base64）
 * @param channelSecret OA の Channel Secret
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string
): boolean {
  if (!signature) return false;
  const hmac = crypto.createHmac("SHA256", channelSecret);
  hmac.update(rawBody);
  const expected = hmac.digest("base64");
  // タイミング攻撃対策で timingSafeEqual を使う
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/** ユーザーの入力が「(再)開始コマンド」かどうかを判定する */
export function isStartCommand(text: string): boolean {
  const n = text.trim().toLowerCase().normalize("NFKC");
  return START_KEYWORDS.has(n);
}

/** ユーザーの入力が「リセットコマンド」かどうかを判定する */
export function isResetCommand(text: string): boolean {
  const n = text.trim().toLowerCase().normalize("NFKC");
  return RESET_KEYWORDS.has(n);
}

/** ユーザーの入力が「つづきからコマンド」かどうかを判定する */
export function isContinueCommand(text: string): boolean {
  const n = text.trim().toLowerCase().normalize("NFKC");
  return CONTINUE_KEYWORDS.has(n);
}

/**
 * ユーザー入力が「開始意図」を持つかどうかを判定する（ゆるいマッチ）。
 * リッチメニューの message アクションが「『作品名』をはじめる」形式のテキストを
 * 送信するケースに対応。
 */
export function isStartIntent(text: string): boolean {
  const n = text
    .trim()
    .normalize("NFKC")
    .replace(/[「」『』【】（）()。！？!?\s]+$/u, "");
  return /をはじめる$|を始める$|をスタート$|を開始$/u.test(n);
}

// ────────────────────────────────────────────────
// Reply API
// ────────────────────────────────────────────────

/**
 * LINE Reply API を呼び出してメッセージを送信する。
 * 失敗してもスローせず、コンソールにエラーを記録するだけにする
 * （Webhook は常に 200 を返す必要があるため）。
 */
export async function replyToLine(
  replyToken: string,
  messages: LineMessage[],
  channelAccessToken: string
): Promise<void> {
  if (!replyToken || messages.length === 0) return;

  // 最大 LINE_MSG_MAX 件に切り詰める
  const sliced = messages.slice(0, LINE_MSG_MAX);
  // _lagMs など内部フィールドを除去（LINE API は未知フィールドをエラーにする場合がある）
  const cleanMessages = sliced.map(stripInternalFields);
  const payload = {
    replyToken,
    messages: cleanMessages,
  };

  // 送信直前ログ: 各メッセージの type / quickReply 有無を確認
  console.log(
    `[replyToLine] 送信 msgs=${sliced.length}件`,
    sliced.map((m, i) => {
      const hasQr = !!(m as { quickReply?: unknown }).quickReply;
      const extra = m.type === "image" ? ` url=${(m as LineImageMessage).originalContentUrl.slice(0, 40)}` : "";
      return `[${i}] type=${m.type} quickReply=${hasQr}${extra}`;
    }).join(" / ")
  );

  try {
    const res = await fetch(LINE_REPLY_URL, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(読み取り不能)");
      console.error(`[LINE Reply] HTTP ${res.status}:`, body);
    }
  } catch (err) {
    console.error("[LINE Reply] ネットワークエラー:", err);
  }
}

// ────────────────────────────────────────────────
// Push API
// ────────────────────────────────────────────────

/**
 * LINE Push API を呼び出してメッセージを送信する。
 * 内部フィールド (_lagMs) を除去してから送信する。
 * 失敗してもスローせず、コンソールにエラーを記録するだけにする。
 */
export async function pushToLine(
  userId:             string,
  messages:           LineMessage[],
  channelAccessToken: string,
): Promise<void> {
  if (!userId || messages.length === 0) return;

  const cleanMessages = messages.map(stripInternalFields);

  console.log(
    `[pushToLine] 送信 userId=${userId.slice(0, 8)} msgs=${cleanMessages.length}件`,
    cleanMessages.map((m, i) => `[${i}] type=${(m as { type: string }).type}`).join(" / ")
  );

  try {
    const res = await fetch(LINE_PUSH_URL, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: userId, messages: cleanMessages }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(読み取り不能)");
      console.error(`[LINE Push] HTTP ${res.status}:`, body);
    }
  } catch (err) {
    console.error("[LINE Push] ネットワークエラー:", err);
  }
}

/**
 * 複数メッセージをラグ付きで送信する。
 *
 * - 1件目: Reply API（replyToken を使用・即送信）
 * - 2件目以降: 各メッセージの _lagMs ms 待機後に Push API で 1 件ずつ送信
 *   - _lagMs が未設定 → DEFAULT_MSG_LAG_MS (1000ms)
 *   - _lagMs が設定済み → min(_lagMs, MAX_MSG_LAG_MS) (上限 2000ms)
 *
 * 1 件のみの場合は通常の replyToLine と同じ動作（Push API は使用しない）。
 */
export async function replyWithLagToLine(
  replyToken:         string,
  messages:           LineMessage[],
  userId:             string,
  channelAccessToken: string,
): Promise<void> {
  if (!replyToken || messages.length === 0) return;

  const sliced = messages.slice(0, LINE_MSG_MAX);

  // 1 件のみ → 通常の replyToLine と同じ（ラグなし）
  if (sliced.length <= 1) {
    await replyToLine(replyToken, sliced, channelAccessToken);
    return;
  }

  // 1 件目を Reply API で即送信（replyToken の有効期限内に必ず呼ぶ）
  const [first, ...rest] = sliced;
  await replyToLine(replyToken, [first], channelAccessToken);

  // 2 件目以降を Push API でラグ付き送信
  for (const msg of rest) {
    const rawLag = msg._lagMs ?? 0;
    const delay  = rawLag > 0 ? Math.min(rawLag, MAX_MSG_LAG_MS) : DEFAULT_MSG_LAG_MS;
    console.log(`[replyWithLagToLine] 次のメッセージまで ${delay}ms 待機`);
    await sleep(delay);
    await pushToLine(userId, [msg], channelAccessToken);
  }
}

// ────────────────────────────────────────────────
// Sender / QuickReply ヘルパー
// ────────────────────────────────────────────────

/**
 * character 情報から LINE sender オブジェクトを生成する。
 *   - sender.name は常に設定する（テキスト・画像アイコン問わず）
 *   - sender.iconUrl は icon_image_url が HTTPS URL の場合のみ設定する
 */
function buildSender(character: {
  name:           string;
  icon_image_url: string | null;
}): LineSender {
  const sender: LineSender = {
    name: character.name.slice(0, 20),
  };
  if (character.icon_image_url?.startsWith("https://")) {
    sender.iconUrl = character.icon_image_url;
  }
  return sender;
}

/**
 * LINE クイックリプライ表示上限
 *
 * LINE 仕様上の最大件数は 13 件だが、UX 上多すぎると選びにくいため
 * このアプリでは 4 件に制限している。
 *
 * 5 件以上の遷移がある場合:
 *   - 先頭 4 件のみ表示（残りは切り捨て）
 *   - コンソールに警告ログを出力（シナリオ設計の見直しを促す）
 *
 * 変更する場合は `QUICK_REPLY_MAX` の値を増やす（最大 13）。
 */
const QUICK_REPLY_MAX = 4;

/**
 * label の配列から LineQuickReply を生成する。
 *   - QUICK_REPLY_MAX 件を超える場合は警告ログを出力し先頭 N 件に切り詰める
 *   - label は最大 20 文字に切り詰める（LINE 仕様）
 *   - タップ時に送信するテキストは label をそのまま使う（message action）
 */
export function buildQuickReply(labels: string[]): LineQuickReply {
  if (labels.length > QUICK_REPLY_MAX) {
    console.warn(
      `[buildQuickReply] 遷移が ${labels.length} 件あります（UX 上限: ${QUICK_REPLY_MAX} 件）。` +
      `先頭 ${QUICK_REPLY_MAX} 件のみ表示します。` +
      `遷移数を減らすか QUICK_REPLY_MAX を調整してください。`,
      labels.slice(QUICK_REPLY_MAX).map((l) => `"${l}"`)
    );
  }
  return {
    items: labels.slice(0, QUICK_REPLY_MAX).map((label) => ({
      type: "action" as const,
      action: {
        type:  "message" as const,
        label: label.slice(0, 20),
        text:  label,
      },
    })),
  };
}

/**
 * QuickReplyItem[] から LineQuickReply を生成する共通ヘルパー。
 * - action: "text" / "next" / "hint" → message アクション（タップ時にテキスト送信）
 * - action: "url"                     → uri アクション（URL を開く）
 * - action: "custom"                  → message アクション（postback は未対応のため text で代替）
 * - items が空の場合は undefined を返す
 */
export function buildQuickReplyFromItems(
  items: QuickReplyItem[],
  opts?: { resolveDestinationUrl?: (destinationId: string) => string | null },
): LineQuickReply | undefined {
  if (!items || items.length === 0) return undefined;

  const lineItems: LineQuickReplyItem[] = items
    .filter((item) => item.enabled !== false)   // enabled=false のアイテムを除外
    .slice(0, QUICK_REPLY_MAX)
    .flatMap((item): LineQuickReplyItem[] => {
      const label = item.label.slice(0, 20);
      if (item.action === "url") {
        // destination_id がある場合は resolved URL を優先
        let uri = item.value || "";
        if (item.destination_id && opts?.resolveDestinationUrl) {
          const resolved = opts.resolveDestinationUrl(item.destination_id);
          if (resolved) uri = resolved;
        }
        if (!uri) return [];
        return [{ type: "action", action: { type: "uri", label, uri } }];
      }
      // hint → ユーザーに見える文言（label）をそのまま送信テキストにする
      // text / next / custom → value 優先、なければ label
      const text = item.action === "hint" ? item.label : (item.value?.trim() || item.label);
      return [{ type: "action", action: { type: "message", label, text } }];
    });

  if (lineItems.length === 0) return undefined;
  return { items: lineItems };
}

// ────────────────────────────────────────────────
// メッセージ変換
// ────────────────────────────────────────────────

/**
 * RuntimePhase の内容を LINE メッセージ配列に変換する。
 *
 * 変換ルール（v2）:
 *   - DB の Message 行を 1 件ずつ独立した吹き出しとして送信する。
 *   - character が設定されていれば sender（name + iconUrl）を付与する。
 *   - 遷移選択肢はクイックリプライ（最大 QUICK_REPLY_MAX 件）として最後のテキストに付与する。
 *   - エンディングフェーズはエンディングメッセージのみ（クイックリプライなし）。
 *   - 固定絵文字は付与しない。システムメッセージは systemSender を使う。
 *   - 最大 LINE_MSG_MAX 件に収まるよう切り詰める。
 */
export function buildPhaseMessages(
  phase: RuntimePhase | null,
  opts: {
    /** フェーズメッセージの前に表示するテキスト（作品開始時の案内など）。絵文字なしで渡すこと。 */
    prefix?: string;
    /** システムメッセージ（prefix / エラー等）の送信者。未指定なら OA デフォルト名義 */
    systemSender?: LineSender;
    /** メッセージ本文のプレースホルダ置換変数（user_name / account_name） */
    vars?: PlaceholderVars;
  } = {}
): LineMessage[] {
  if (!phase) {
    return [{
      type:   "text",
      text:   "申し訳ありません、エラーが発生しました。しばらく経ってからもう一度お試しください。",
      sender: opts.systemSender,
    }];
  }

  const messages: LineMessage[] = [];
  const vars = opts.vars ?? {};

  // ── prefix テキスト（システム通知として独立した吹き出し） ──
  const prefixText = opts.prefix?.trim();
  if (prefixText) {
    messages.push({ type: "text", text: replacePlaceholders(prefixText, vars), sender: opts.systemSender });
  }

  // ── DB Message 行を 1 件ずつ独立した吹き出しに変換 ──
  // 変換契約は convertMessageToLine() に集約されている。
  const inputCount = phase.messages.length;
  for (const msg of phase.messages) {
    // hint_mode に基づいてヒント QR をフィルタ
    const visibleQrItems = (msg.hint_mode === "always" || !msg.hint_mode)
      ? msg.quick_replies
      : (msg.quick_replies ?? []).filter((i) => i.action !== "hint");
    const msgQr = visibleQrItems?.length
      ? buildQuickReplyFromItems(visibleQrItems)
      : undefined;

    const lineMsg = convertMessageToLine({
      id:        msg.id,
      kind:      msg.kind,
      mtype:     msg.message_type as string,
      body:      msg.body,
      asset_url: msg.asset_url,
      alt_text:  msg.alt_text,
      sender:    msg.character ? buildSender(msg.character) : undefined,
      quickReply: msgQr,
      lagMs:     msg.lag_ms,
    }, "buildPhaseMessages", phase.id, vars);

    if (lineMsg) {
      messages.push(lineMsg);
    } else {
      console.warn(
        `[buildPhaseMessages] ⚠️ メッセージ変換失敗（LINE送信から除外）`,
        `id=${msg.id.slice(0, 8)} type=${msg.message_type} sort=${msg.sort_order}`,
        `body=${msg.body ? `"${msg.body.slice(0, 30)}"` : "null"} asset=${msg.asset_url ? "あり" : "null"} alt=${msg.alt_text ? "あり" : "null"}`,
      );
    }
  }

  // ── サマリログ ──
  const prefixOffset = prefixText ? 1 : 0;
  logConversionSummary("buildPhaseMessages", phase.id, inputCount, messages.length - prefixOffset);

  // ── エンディング or クイックリプライ付与 ──
  if (phase.transitions === null) {
    // エンディングフェーズ — シナリオ定義のメッセージのみ送信（自動メッセージは送らない）
  } else if (phase.transitions.length === 0) {
    // 遷移未設定 — β: システム文言を出さずメッセージのみ表示
    // （シナリオ制作中の場合でも没入感を損なわないよう何も追加しない）
  } else {
    // LINE は最後のメッセージの quickReply のみ表示する仕様のため、
    // すでに最後のメッセージにユーザー設定の quickReply がある場合は
    // 遷移 quickReply を追加しない（ユーザー設定 QR が優先される）。
    const lastMsg = messages.length > 0
      ? (messages[messages.length - 1] as { quickReply?: LineQuickReply })
      : null;

    if (!lastMsg?.quickReply) {
      // 遷移 quickReply を、個別 quickReply が未設定の最後のメッセージ（型不問）に付与
      const transitionQr = buildQuickReply(phase.transitions.map((t) => t.label));

      let attached = false;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as { quickReply?: LineQuickReply };
        if (!m.quickReply) {
          m.quickReply = transitionQr;
          attached = true;
          break;
        }
      }
      // メッセージが 0 件の場合はシステム送信者でナビを追加
      if (!attached) {
        messages.push({ type: "text", text: "続きを選んでください。", quickReply: transitionQr, sender: opts.systemSender });
      }
    }
  }

  return messages.slice(0, LINE_MSG_MAX);
}

/** 5000 文字を超えるテキストを安全に切り詰める */
export function truncateText(text: string, max = LINE_TEXT_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "…";
}

// ────────────────────────────────────────────────
// triggerKeyword マッチ時のメッセージ変換
// ────────────────────────────────────────────────

/** `Message` テーブルの行（triggerKeyword マッチ / kind="start" メッセージ）を LINE メッセージ配列に変換する */
export type KeywordMessageRecord = {
  id:              string;
  messageType:     string;
  body:            string | null;
  assetUrl:        string | null;
  altText:         string | null;
  flexPayloadJson: string | null;
  /** DB の quickReplies カラム（JSON 文字列）。parse して LineQuickReply に変換する */
  quickReplies:    string | null;
  /** 連続送信チェーン先メッセージ ID（null = チェーンなし） */
  nextMessageId:   string | null;
  sortOrder:       number;
  character: {
    name:         string;
    iconImageUrl: string | null;
  } | null;
};

/**
 * triggerKeyword にマッチした / kind="start" の Message レコード群を LINE メッセージ配列に変換する。
 * - メッセージ個別の quickReplies（DB JSON 文字列）を parse して LINE quickReply に変換する
 * - systemSender はキャラクターが未設定のメッセージに適用する
 */
export function buildKeywordMessages(
  records:       KeywordMessageRecord[],
  systemSender?: LineSender,
  vars:          PlaceholderVars = {},
): LineMessage[] {
  const messages: LineMessage[] = [];
  const inputCount = records.length;

  for (const msg of records) {
    const sender: LineSender | undefined = msg.character
      ? buildSender({ name: msg.character.name, icon_image_url: msg.character.iconImageUrl })
      : systemSender;

    // DB の quickReplies (JSON 文字列) を parse
    let msgQr: LineQuickReply | undefined;
    if (msg.quickReplies) {
      try {
        const items = JSON.parse(msg.quickReplies) as QuickReplyItem[];
        msgQr = buildQuickReplyFromItems(items);
      } catch {
        console.warn(`[buildKeywordMessages] quickReplies JSON parse error msgId=${msg.id}`);
      }
    }

    // 共通変換ヘルパー（buildPhaseMessages と同一ロジック）
    const lineMsg = convertMessageToLine({
      id:        msg.id,
      mtype:     msg.messageType as string,
      body:      msg.body,
      asset_url: msg.assetUrl,
      alt_text:  msg.altText,
      sender,
      quickReply: msgQr,
    }, "buildKeywordMessages", "keyword");

    if (lineMsg) messages.push(lineMsg);
  }

  // サマリログ
  logConversionSummary("buildKeywordMessages", "keyword", inputCount, messages.length);

  // LINE は最後のメッセージの quickReply のみ表示する仕様のため、
  // 中間メッセージに quickReply が設定されていたら最後のメッセージに移動する。
  const sliced = messages.slice(0, LINE_MSG_MAX);
  if (sliced.length > 1) {
    const lastMsg = sliced[sliced.length - 1] as { quickReply?: LineQuickReply };
    if (!lastMsg.quickReply) {
      for (let i = sliced.length - 2; i >= 0; i--) {
        const m = sliced[i] as { quickReply?: LineQuickReply };
        if (m.quickReply) {
          lastMsg.quickReply = m.quickReply;
          delete m.quickReply;
          break;
        }
      }
    }
  }
  return sliced;
}
