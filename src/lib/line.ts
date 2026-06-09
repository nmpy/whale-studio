// src/lib/line.ts
// LINE Messaging API ヘルパー
//
// 責務:
//   - X-Line-Signature 検証（HMAC-SHA256）
//   - Reply API 呼び出し
//   - RuntimePhase → LINE メッセージ変換

import crypto from "crypto";
import type { RuntimePhase, QuickReplyItem, MessageTimingConfig } from "@/types";
import { interpolate } from "@/lib/template";
import { moveQuickReplyToTail } from "@/lib/quick-reply-tail";
import { isFreeInputPrompt } from "@/lib/free-input";
import type { ReadReceiptController } from "@/lib/line-read-receipt";

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
  /** @internal LINE API には送信しない。replyWithLagToLine で per-message timing 適用に使用 */
  _timing?: MessageTimingConfig;
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
  /** @internal LINE API には送信しない。replyWithLagToLine で per-message timing 適用に使用 */
  _timing?: MessageTimingConfig;
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
  /** @internal LINE API には送信しない。replyWithLagToLine で per-message timing 適用に使用 */
  _timing?: MessageTimingConfig;
};

/** Flex Message action (LINE 仕様の部分集合)。message / uri / postback のみ実装。 */
export type LineFlexAction =
  | { type: "message"; label?: string; text: string }
  | { type: "uri";     label?: string; uri:  string }
  | { type: "postback"; label?: string; data: string; displayText?: string };

/** Flex Message (画像 + アクション用 = 1 bubble に hero image)。 */
export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: {
    type: "bubble";
    hero: {
      type: "image";
      url: string;
      size: "full";
      aspectRatio: string;   // "20:13" など
      aspectMode: "cover" | "fit";
      action?: LineFlexAction;
    };
  };
  sender?: LineSender;
  quickReply?: LineQuickReply;
  _lagMs?: number;
  _timing?: MessageTimingConfig;
};

export type LineMessage = LineTextMessage | LineImageMessage | LineVideoMessage | LineFlexMessage;

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
  /** 自由入力受付モードで保存したユーザー固有変数 (UserProgress.variables)。
   *  `{userName}` `{nickname}` 等の `{key}` 形式を本文内で展開する。
   *  未指定 / undefined の場合は interpolate は no-op。 */
  userVariables?: Record<string, string>;
};

/**
 * テキスト内の `{{user_name}}` / `{{account_name}}` (二重括弧) を実際の値へ置換する。
 * 値が未設定（undefined）の場合は空文字へ置換し、プレースホルダ文字列が露出しないようにする。
 *
 * 加えて、`userVariables` が指定されていれば、自由入力受付モード用の
 * `{key}` 形式 (一重括弧) も同じパスで展開する (interpolate 経由)。
 * 未保存変数は空文字に置換する (テンプレ文字列を表示しないため)。
 */
export function replacePlaceholders(text: string, vars: PlaceholderVars): string {
  let out = text
    .replace(/\{\{user_name\}\}/g,    vars.userName    ?? "")
    .replace(/\{\{account_name\}\}/g, vars.accountName ?? "");
  if (vars.userVariables !== undefined) {
    out = interpolate(out, vars.userVariables);
  }
  return out;
}

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────

const LINE_REPLY_URL     = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL      = "https://api.line.me/v2/bot/message/push";
const LINE_TEXT_MAX      = 5000; // LINE テキストメッセージの最大文字数
const LINE_MSG_MAX       = 5;    // 1 回の reply で送れる最大メッセージ数
const DEFAULT_MSG_LAG_MS = 1000; // lag_ms 未設定時のメッセージ間待機時間（ms）
const MAX_MSG_LAG_MS = 600000; // lag_ms の上限値（ms）

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

/** 画像メッセージのタップ時アクション設定 (DB 列群を要約した形)。 */
export type ImageActionSpec = {
  type:          string | null;  // "message" | "uri" | "liff" | "postback" | "none" | null
  text:          string | null;  // type="message"
  url:           string | null;  // type="uri"
  liffPageId:    string | null;  // type="liff"
  postbackData:  string | null;  // type="postback"
};

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
  /** 画像タップ時アクション (messageType="image" のときのみ有効、未指定は null) */
  imageAction?: ImageActionSpec | null;
  /** LIFF endpoint URL (type="liff" 時の解決用)。未指定なら liff URL は生成しない */
  liffEndpointUrl?: string | null;
  sender?:    LineSender;
  quickReply?: LineQuickReply;
  lagMs?:     number;
  /** メッセージ単位の演出設定 (= LineMessage._timing として搬送) */
  timing?:    MessageTimingConfig | null;
};

const DEFAULT_IMAGE_ALT_TEXT = "画像メッセージ";
const DEFAULT_IMAGE_ASPECT_RATIO = "20:13";

/** 画像 + action 用 Flex Message を生成する。url は HTTPS 必須。
 *  imageAction が null や type="none" の場合は null を返す (= 通常 Image Message を使う)。 */
export function buildImageActionFlex(args: {
  imageUrl: string;
  altText:  string | null;
  imageAction: ImageActionSpec | null;
  liffEndpointUrl?: string | null;
}): LineFlexMessage | null {
  const { imageUrl, imageAction, liffEndpointUrl } = args;
  if (!imageAction || !imageAction.type || imageAction.type === "none") return null;
  if (!imageUrl.startsWith("https://")) {
    console.warn(`[buildImageActionFlex] HTTPS URL のみ対応 (received: ${imageUrl.slice(0, 60)})`);
    return null;
  }
  let action: LineFlexAction | undefined;
  switch (imageAction.type) {
    case "message":
      if (!imageAction.text) return null;
      action = {
        type:  "message",
        label: imageAction.text.slice(0, 20),
        text:  imageAction.text.slice(0, 300),
      };
      break;
    case "uri":
      if (!imageAction.url || !imageAction.url.startsWith("https://")) return null;
      action = { type: "uri", label: "開く", uri: imageAction.url };
      break;
    case "liff":
      if (!imageAction.liffPageId || !liffEndpointUrl) return null;
      action = { type: "uri", label: "開く", uri: liffEndpointUrl };
      break;
    case "postback":
      if (!imageAction.postbackData) return null;
      action = { type: "postback", label: "実行", data: imageAction.postbackData };
      break;
    default:
      return null;
  }
  const safeAlt = (args.altText?.trim() || DEFAULT_IMAGE_ALT_TEXT).slice(0, 400);
  return {
    type: "flex",
    altText: safeAlt,
    contents: {
      type: "bubble",
      hero: {
        type:        "image",
        url:         imageUrl,
        size:        "full",
        aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
        aspectMode:  "cover",
        action,
      },
    },
  };
}

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
  const { id, kind, mtype, body, asset_url, alt_text, sender, quickReply, lagMs, timing } = msg;
  const isPuzzle = kind === "puzzle";

  /** LINE メッセージ共通フィールドを付与するヘルパー */
  const attach = <T extends LineMessage>(m: T): T => {
    if (sender) m.sender = sender;
    if (quickReply) m.quickReply = quickReply;
    if (lagMs && lagMs > 0) m._lagMs = lagMs;
    // null は inherit。undefined と区別して扱う必要はないので、非 null/undefined のときのみセット。
    if (timing) m._timing = timing;
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
    if (asset_url) {
      // 画像タップ時アクションが設定されていれば Flex Message に変換する。
      // 未設定 (= null / "none") なら従来通り Image Message として送信。
      const flex = buildImageActionFlex({
        imageUrl:    asset_url,
        altText:     alt_text,
        imageAction: msg.imageAction ?? null,
        liffEndpointUrl: msg.liffEndpointUrl ?? null,
      });
      if (flex) return attach(flex);
      return attach({ type: "image", originalContentUrl: asset_url, previewImageUrl: asset_url } as LineImageMessage);
    }
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

/** LineMessage から内部フィールド（_lagMs / _timing）を除去して送信用オブジェクトを生成する */
function stripInternalFields(msg: LineMessage): Record<string, unknown> {
  const m = { ...msg } as Record<string, unknown>;
  delete m._lagMs;
  delete m._timing;
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
): Promise<{ ok: boolean; status?: number }> {
  // 送信結果を返す（成功/失敗を呼出側で判定できるようにする。
  // 既存の `await pushToLine(...)` 呼出は戻り値を無視するため後方互換）。
  if (!userId || messages.length === 0) return { ok: false };

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
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[LINE Push] ネットワークエラー:", err);
    return { ok: false };
  }
}

/**
 * 複数メッセージをラグ付きで送信する。
 *
 * - 1件目: Reply API（replyToken を使用・即送信）
 * - 2件目以降: 各メッセージの _lagMs ms 待機後に Push API で 1 件ずつ送信
 *   - _lagMs が未設定 → DEFAULT_MSG_LAG_MS (1000ms)
 *   - _lagMs が設定済み → min(_lagMs, MAX_MSG_LAG_MS)
 *
 * Phase 2c: 各メッセージの `_timing` が設定されていれば、push 直前に
 * ReadReceiptController.applyMessageTiming() を呼んで該当 message の
 * typing 待機を効かせる。controller が未指定なら従来通り lag のみ。
 *
 * 1 件のみの場合は通常の replyToLine と同じ動作（Push API は使用しない）。
 */
export async function replyWithLagToLine(
  replyToken:         string,
  messages:           LineMessage[],
  userId:             string,
  channelAccessToken: string,
  controller?:        ReadReceiptController,
): Promise<void> {
  if (!replyToken || messages.length === 0) return;

  // 1 件のみ → 通常の replyToLine と同じ（ラグなし）
  if (messages.length <= 1) {
    await replyToLine(replyToken, messages, channelAccessToken);
    return;
  }

  // [diag] sequence 全体: 各 message の id + lag + timing 概要を出す
  console.log(
    `[diag][timing-sequence] count=${messages.length} ids=[${messages.map((m) => idOf(m)).join(",")}]`,
  );
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const t = m._timing;
    console.log(
      `[diag][timing-sequence][${i}] msg=${idOf(m)} lag=${m._lagMs ?? "—"}`,
      `typing=${t?.typing_enabled ?? "—"}`,
      `typingMin=${t?.typing_min_ms ?? "—"}`,
      `typingMax=${t?.typing_max_ms ?? "—"}`,
      `loading=${t?.loading_enabled ?? "—"}`,
      `readMode=${t?.read_receipt_mode ?? "—"}`,
    );
  }

  // 1 件目を Reply API で即送信（replyToken の有効期限内に必ず呼ぶ）
  const [first, ...rest] = messages;
  await replyToLine(replyToken, [first], channelAccessToken);

  // Phase 2c hotfix: chain 送信に入る前に webhook-level scheduleLoading を抑止する。
  // 理由: webhook 開始時に予約された loading が msg1/msg2 の間 (= lag/typing 待機中) に
  //       発火すると、ユーザー体感では「msg1/msg2 の合間にランダムに loading が出る」
  //       不安定さに見える。chain 内 per-message の loading は下のループで明示的に
  //       showLoadingForMessage で処理する。
  if (controller) {
    controller.abortPendingLoading();
    console.log(`[diag][timing-loading-abort] chain送信開始のため webhook scheduleLoading を abort`);
  }

  // 2 件目以降を Push API でラグ付き 1 件ずつ送信（件数制限なし）
  console.log(`[replyWithLagToLine] reply=1件 push=${rest.length}件 total=${messages.length}件`);
  for (let i = 0; i < rest.length; i++) {
    const msg = rest[i];
    const rawLag = msg._lagMs ?? 0;
    const delay  = rawLag > 0 ? Math.min(rawLag, MAX_MSG_LAG_MS) : DEFAULT_MSG_LAG_MS;
    console.log(
      `[diag][timing-send-before] msg=${idOf(msg)} waitLag=${delay}ms`,
      `typing=${msg._timing?.typing_enabled ?? "—"}`,
      `loading=${msg._timing?.loading_enabled ?? "—"}`,
      `lagSource=${msg._lagMs != null ? "_lagMs" : "default"}`,
    );
    await sleep(delay);
    // Phase 2c: per-message 演出を反映する (typing → loading の順)。
    // chain head の typing は waitTypingBeforeReply で適用済み。
    // 2 通目以降は waitTypingForMessage / showLoadingForMessage を使い、
    // receivedAt 経過時間に縛られずメッセージ作者の設定を効かせる。
    // _timing が無ければ何もしない (= 単に lag のみ待つ)。
    const typingStart = Date.now();
    if (controller && msg._timing) {
      console.log(`[diag][typing-before] msg=${idOf(msg)} via=perMessage (chain push #${i + 1})`);
      await controller.waitTypingForMessage(msg._timing);
      await controller.showLoadingForMessage(msg._timing);
    } else {
      console.log(`[diag][typing-before] msg=${idOf(msg)} via=none (no _timing or no ctrl)`);
    }
    const typingWaited = Date.now() - typingStart;
    console.log(`[diag][typing-after] msg=${idOf(msg)} waitedMs=${typingWaited} (chain push #${i + 1})`);
    await pushToLine(userId, [msg], channelAccessToken);
    console.log(`[diag][timing-send-after] msg=${idOf(msg)} pushed=true typingWaited=${typingWaited}ms`);
  }
  console.log(`[replyWithLagToLine] 完了 reply=1 push=${rest.length} total=${messages.length}`);
}

/** [diag] LineMessage の識別用に内部 id を取り出す。
 *  LineMessage 型には id がないため、Image なら url の末尾、Text なら本文先頭で代用する。 */
function idOf(m: LineMessage): string {
  if (m.type === "text") return `txt:${(m.text ?? "").slice(0, 14)}`;
  if (m.type === "image") return `img:…${m.originalContentUrl.slice(-12)}`;
  if (m.type === "video") return `vid:…${m.originalContentUrl.slice(-12)}`;
  return `flex:${m.altText?.slice(0, 14) ?? "?"}`;
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
  //
  // chain-aware iteration:
  //   phase.messages は heads と chain continuation が混在しており、かつ continuation は
  //   親の sort_order を継承するため、単純に flat 走査 + moveQuickReplyToTail を一度かけると
  //   chain head の QR が phase 全体末尾の関係ないメッセージへ移動してしまう。
  //   管理画面（messages list page）と表示順・QR 位置を一致させるため、ここでは:
  //     1. phase.messages から「他のメッセージから next_message_id で参照されている ID」を
  //        continuation 集合として抽出
  //     2. heads (= continuation 集合に含まれないもの) を phase.messages 内の DB 順
  //        (sortOrder asc, createdAt asc) で iterate
  //     3. 各 head から next_message_id を walk して chain を作り、chain 単位で
  //        moveQuickReplyToTail を適用
  //     4. chain ごとに LineMessage[] を生成 → 全体 messages に concat
  //   これにより chain head の QR は chain tail に集約され、別 chain には漏れない。
  //   walk 中に phase.messages に存在しない id を指していたら chain はそこで停止する
  //   (= 別 phase / 削除済み / orphan な link は安全に無視)。
  const inputCount = phase.messages.length;

  const phaseById = new Map(phase.messages.map((m) => [m.id, m]));
  const continuationIds = new Set<string>();
  for (const m of phase.messages) {
    if (m.next_message_id) continuationIds.add(m.next_message_id);
  }

  // 1 件の Phase message を LineMessage に変換するヘルパー (per-chain ループで再利用)。
  const convert = (msg: typeof phase.messages[number]): LineMessage | null => {
    const visibleQrItems = (msg.hint_mode === "always" || !msg.hint_mode)
      ? msg.quick_replies
      : (msg.quick_replies ?? []).filter((i) => i.action !== "hint");
    const msgQr = visibleQrItems?.length
      ? buildQuickReplyFromItems(visibleQrItems)
      : undefined;
    return convertMessageToLine({
      id:        msg.id,
      kind:      msg.kind,
      mtype:     msg.message_type as string,
      body:      msg.body,
      asset_url: msg.asset_url,
      alt_text:  msg.alt_text,
      imageAction: msg.image_action_type ? {
        type:         msg.image_action_type,
        text:         msg.image_action_text         ?? null,
        url:          msg.image_action_url          ?? null,
        liffPageId:   msg.image_action_liff_page_id ?? null,
        postbackData: msg.image_action_postback_data ?? null,
      } : null,
      sender:    msg.character ? buildSender(msg.character) : undefined,
      quickReply: msgQr,
      lagMs:     msg.lag_ms,
      timing:    msg.timing,
    }, "buildPhaseMessages", phase.id, vars);
  };

  // 自由入力プロンプト到達フラグ: chain walk が free_input_enabled=true の message に
  // 到達したら、その時点で phase 全体の iteration も停止する。
  // 仕様: 「自由入力受付メッセージは、そこで一旦停止して waitingForInput をセットする」。
  // → 同 phase 内の sort_order が自由入力プロンプトより後の独立 head は、
  //   応答メッセージ (free_input_next_message_id 経由) で送るのが正しいため、
  //   この phase response では送らない。
  let stoppedAtFreeInput = false;
  // placeholder safety guard の例外集合: freeInputEnabled=true の prompt 由来 LineMessage は
  // 未置換 placeholder を含んでいても除外しない (= ユーザー入力前に出すプロンプト本体は
  // 必ず送る必要があるため)。WeakSet で identity 比較する。
  const freeInputPromptLineMsgs = new WeakSet<LineMessage>();
  for (const head of phase.messages) {
    if (stoppedAtFreeInput) break;
    // continuation はこのループでは扱わない (= head 経由で chain 内に展開する)。
    if (continuationIds.has(head.id)) continue;

    // chain を walk して LineMessage[] を作る (cap = LINE 上限分の余裕)。
    const chainMessages: LineMessage[] = [];
    const visited = new Set<string>([head.id]);
    let cur: typeof phase.messages[number] | undefined = head;
    while (cur && chainMessages.length < LINE_MSG_MAX) {
      const lineMsg = convert(cur);
      if (lineMsg) {
        chainMessages.push(lineMsg);
        // freeInputEnabled=true の prompt は placeholder safety guard の対象外にする
        if (isFreeInputPrompt(cur)) freeInputPromptLineMsgs.add(lineMsg);
      } else {
        console.warn(
          `[buildPhaseMessages] ⚠️ メッセージ変換失敗（LINE送信から除外）`,
          `id=${cur.id.slice(0, 8)} kind=${cur.kind} type=${cur.message_type} sort=${cur.sort_order}`,
          `body=${cur.body ? `"${cur.body.slice(0, 30)}"` : "null"} asset=${cur.asset_url ? "あり" : "null"} alt=${cur.alt_text ? "あり" : "null"}`,
        );
      }
      // この message が自由入力受付なら、その message を含めて chain walk + phase iteration を停止する。
      // 判定は camelCase / snake_case 両対応の helper を使う (= cache の shape ずれや
      // 経路ごとのフィールド名差異で stop が漏れるのを構造的に防ぐ)。
      if (isFreeInputPrompt(cur)) {
        stoppedAtFreeInput = true;
        console.log(
          `[buildPhaseMessages] STOP at free_input id=${cur.id.slice(0, 8)} sort=${cur.sort_order} ` +
          `freeInputEnabled=${(cur as { freeInputEnabled?: unknown }).freeInputEnabled} free_input_enabled=${cur.free_input_enabled} ` +
          `(phase iteration も停止。後続の独立 head は free_input_next_message_id 経由で送るのが正しい仕様)`,
        );
        break;
      }
      const nextId = cur.next_message_id;
      if (!nextId || visited.has(nextId)) break;  // 終端 or 循環防止
      const nextMsg = phaseById.get(nextId);
      if (!nextMsg) break;  // 別 phase or orphan link は安全に停止
      visited.add(nextId);
      cur = nextMsg;
    }

    // chain head の QR を chain tail へ集約 (chain 内で完結させる)。
    moveQuickReplyToTail(chainMessages as { quickReply?: LineQuickReply }[]);

    // phase 全体に append (chain 順は維持)。
    for (const lm of chainMessages) messages.push(lm);
  }

  // ── サマリログ ──
  const prefixOffset = prefixText ? 1 : 0;
  logConversionSummary("buildPhaseMessages", phase.id, inputCount, messages.length - prefixOffset);

  // ── safety guard: 未置換の placeholder (= {xxx} がそのまま残っている) を検出 + 除外 ──
  // 想定シナリオ: 自由入力プロンプトの応答 (= free_input_next_message_id 先) 用に
  // 本文 "{freeText}..." を持つメッセージが、誤って通常 phase response に
  // 混ざってしまった場合、ユーザー入力前なので `{freeText}` が未置換のまま LINE に
  // 届いてしまう。runtime safety guard として:
  //   1) warn ログでデータ修正の手がかりを残す
  //   2) **該当メッセージを LINE 送信対象から除外する** (= 入力前に literal `{xxx}` が
  //      ユーザーに届く事故を防ぐ)
  // 既知 placeholder (`{user_name}` / `{account_name}` 等) は vars 側で必ず
  // 置換される前提なので、ここで残っている = 未解決の placeholder のみ対象。
  // ユーザー指示: 「freeInput 前の phase response では safety guard として除外する」
  const UNRESOLVED_PLACEHOLDER_RE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
  const filteredMessages: LineMessage[] = [];
  for (const m of messages) {
    // freeInputEnabled=true の prompt はユーザー入力前に必ず出すメッセージ。たとえ
    // 未置換 placeholder を含んでいても safety guard では除外せず、そのまま送る。
    // (= 仕様: 「freeInputEnabled=true のプロンプト自体は送信対象から除外しない」)
    if (freeInputPromptLineMsgs.has(m)) {
      filteredMessages.push(m);
      continue;
    }
    const lm = m as { type?: string; text?: string; altText?: string };
    const candidate = lm.text ?? lm.altText ?? "";
    if (UNRESOLVED_PLACEHOLDER_RE.test(candidate)) {
      const match = candidate.match(UNRESOLVED_PLACEHOLDER_RE);
      console.warn(
        `[buildPhaseMessages] ⚠️ 未置換 placeholder 検出 → 送信対象から除外 phase=${phase.id.slice(0, 8)} ` +
        `placeholder="${match?.[0]}" text(20)="${candidate.slice(0, 20)}" ` +
        `(自由入力プロンプトの応答メッセージが phase response に混ざっている。` +
        `データ確認: 該当 message は free_input_next_message_id 経由で送るのが正しい)`,
      );
      continue;  // ← LINE 送信対象から除外
    }
    filteredMessages.push(m);
  }
  // 元の `messages` 配列を filtered 版に置き換える (= in-place 操作で後段の transition QR
  // 付与処理にも反映させる)。
  messages.length = 0;
  messages.push(...filteredMessages);

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
  // 画像タップ時アクション (messageType="image" のとき有効)
  imageActionType?:         string | null;
  imageActionText?:         string | null;
  imageActionUrl?:          string | null;
  imageActionLiffPageId?:   string | null;
  imageActionPostbackData?: string | null;
  /** 前のメッセージ送信後の待機時間 (ms)。chain 内 2 通目以降で使用 */
  lagMs?:                   number | null;
  /** メッセージ単位の演出設定 (= LineMessage._timing として搬送) */
  timing?:                  MessageTimingConfig | null;
  /** 自由入力受付フラグ。true の message は buildMessageChain での chain walk を停止する
   *  (= 通常 nextMessageId による連続送信は行わず、応答は free_input_next_message_id 経由)。 */
  freeInputEnabled?:        boolean | null;
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
      imageAction: msg.imageActionType ? {
        type:         msg.imageActionType,
        text:         msg.imageActionText         ?? null,
        url:          msg.imageActionUrl          ?? null,
        liffPageId:   msg.imageActionLiffPageId   ?? null,
        postbackData: msg.imageActionPostbackData ?? null,
      } : null,
      sender,
      quickReply: msgQr,
      lagMs:      msg.lagMs ?? 0,
      timing:     msg.timing ?? null,
    }, "buildKeywordMessages", "keyword", vars);

    if (lineMsg) messages.push(lineMsg);
  }

  // サマリログ
  logConversionSummary("buildKeywordMessages", "keyword", inputCount, messages.length);

  // LINE は最後のメッセージの quickReply のみ表示する仕様のため、
  // 中間メッセージに quickReply が設定されていたら最後のメッセージに移動する。
  // (= chain head の QR は chain tail で表示される。buildPhaseMessages と同じ挙動)
  const sliced = messages.slice(0, LINE_MSG_MAX);
  moveQuickReplyToTail(sliced as { quickReply?: LineQuickReply }[]);
  return sliced;
}
