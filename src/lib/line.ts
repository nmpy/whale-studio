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
};

export type LineImageMessage = {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
  /** キャラクター送信者情報（任意） */
  sender?: LineSender;
};

export type LineFlexMessage = {
  type: "flex";
  /** 通知欄・未対応端末向けの代替テキスト */
  altText: string;
  /** Flex Message コンテナ（bubble / carousel） */
  contents: Record<string, unknown>;
  /** キャラクター送信者情報（任意） */
  sender?: LineSender;
};

export type LineMessage = LineTextMessage | LineImageMessage | LineFlexMessage;

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
};

export type LineWebhookBody = {
  destination: string;
  events: LineEvent[];
};

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_TEXT_MAX  = 5000; // LINE テキストメッセージの最大文字数
const LINE_MSG_MAX   = 5;    // 1 回の reply で送れる最大メッセージ数

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
  const payload = {
    replyToken,
    messages: messages.slice(0, LINE_MSG_MAX),
  };

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
): LineQuickReply | undefined {
  if (!items || items.length === 0) return undefined;

  const lineItems: LineQuickReplyItem[] = items
    .slice(0, QUICK_REPLY_MAX)
    .flatMap((item): LineQuickReplyItem[] => {
      const label = item.label.slice(0, 20);
      if (item.action === "url") {
        if (!item.value) return [];
        return [{ type: "action", action: { type: "uri", label, uri: item.value } }];
      }
      // text / next / hint / custom → message アクション
      const text = item.value?.trim() || item.label;
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

  // ── prefix テキスト（システム通知として独立した吹き出し） ──
  const prefixText = opts.prefix?.trim();
  if (prefixText) {
    messages.push({ type: "text", text: prefixText, sender: opts.systemSender });
  }

  // ── DB Message 行を 1 件ずつ独立した吹き出しに変換 ──
  for (const msg of phase.messages) {
    // メッセージ個別 quickReply（設定されていれば phase-level 遷移より優先）
    const msgQr = msg.quick_replies?.length
      ? buildQuickReplyFromItems(msg.quick_replies)
      : undefined;

    if (msg.message_type === "text" && msg.body) {
      const lineMsg: LineTextMessage = {
        type: "text",
        text: msg.body,
      };
      if (msg.character) {
        lineMsg.sender = buildSender(msg.character);
      }
      if (msgQr) lineMsg.quickReply = msgQr;
      messages.push(lineMsg);
    }

    if (msg.message_type === "image" && msg.asset_url) {
      const lineMsg: LineImageMessage = {
        type:               "image",
        originalContentUrl: msg.asset_url,
        previewImageUrl:    msg.asset_url,
      };
      if (msg.character) {
        lineMsg.sender = buildSender(msg.character);
      }
      messages.push(lineMsg);
    }

    if (msg.message_type === "flex" && msg.alt_text && msg.flex_payload_json) {
      let contents: Record<string, unknown> | null = null;
      try {
        contents = JSON.parse(msg.flex_payload_json) as Record<string, unknown>;
      } catch {
        console.warn(`[buildPhaseMessages] Flex JSON parse error msgId=${msg.id}`);
      }
      if (contents) {
        const lineMsg: LineFlexMessage = {
          type:     "flex",
          altText:  msg.alt_text,
          contents,
        };
        if (msg.character) {
          lineMsg.sender = buildSender(msg.character);
        }
        messages.push(lineMsg);
      }
    }
  }

  // ── エンディング or クイックリプライ付与 ──
  if (phase.transitions === null) {
    // エンディングフェーズ — 作品のメッセージが終わったあと、再プレイ案内のみをシステム送信者で添える
    messages.push({
      type:   "text",
      text:   "最後まで遊んでいただきありがとうございました。\n\n「はじめる」と送ると最初から楽しめます。",
      sender: opts.systemSender,
    });
  } else if (phase.transitions.length === 0) {
    // 遷移未設定 — β: システム文言を出さずメッセージのみ表示
    // （シナリオ制作中の場合でも没入感を損なわないよう何も追加しない）
  } else {
    // 遷移 quickReply を、個別 quickReply が未設定の最後のテキストメッセージに付与
    const transitionQr = buildQuickReply(phase.transitions.map((t) => t.label));

    let attached = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "text" && !(m as LineTextMessage).quickReply) {
        (m as LineTextMessage).quickReply = transitionQr;
        attached = true;
        break;
      }
    }
    // 全テキストメッセージに個別 quickReply が設定済み or テキストが 0 件の場合は
    // システム送信者でナビを追加
    if (!attached) {
      messages.push({ type: "text", text: "続きを選んでください。", quickReply: transitionQr, sender: opts.systemSender });
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
  records:      KeywordMessageRecord[],
  systemSender?: LineSender,
): LineMessage[] {
  const messages: LineMessage[] = [];

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

    if (msg.messageType === "text" && msg.body) {
      const lineMsg: LineTextMessage = { type: "text", text: msg.body, sender };
      if (msgQr) lineMsg.quickReply = msgQr;
      messages.push(lineMsg);
    } else if (msg.messageType === "image" && msg.assetUrl) {
      const lineMsg: LineImageMessage = {
        type:               "image",
        originalContentUrl: msg.assetUrl,
        previewImageUrl:    msg.assetUrl,
      };
      if (sender) lineMsg.sender = sender;
      messages.push(lineMsg);
    } else if (msg.messageType === "flex" && msg.altText && msg.flexPayloadJson) {
      try {
        const contents = JSON.parse(msg.flexPayloadJson) as Record<string, unknown>;
        const lineMsg: LineFlexMessage = {
          type:     "flex",
          altText:  msg.altText,
          contents,
        };
        if (sender) lineMsg.sender = sender;
        messages.push(lineMsg);
      } catch {
        console.warn(`[buildKeywordMessages] Flex JSON parse error msgId=${msg.id}`);
      }
    }
  }

  return messages.slice(0, LINE_MSG_MAX);
}
