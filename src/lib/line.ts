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
import { showLoadingAnimation, resolveCmsLoadingPlan } from "@/lib/line-read-receipt";
import { resolveDisplayQrItems } from "@/lib/hint-qr";
import { buildPuzzleHintPostbackData } from "@/lib/puzzle-hint";
import { buildQuickReplyPostbackData, quickReplyItemHasDestination } from "@/lib/quick-reply-postback";
import { buildFlexSendParts, type FlexContents } from "@/lib/flex";
import { normalizeCarouselContent, buildCarouselFlex } from "@/lib/carousel";
import { buildCallRequestFlex, classifyCallRequestConfig } from "@/lib/call-request";
import { recordPuzzleDeliveries } from "@/lib/puzzle-history";

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
  /** @internal 送信順デバッグ用の由来 message id（送信直前 strip）。 */
  _sourceMessageId?: string;
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
  /** @internal 送信順デバッグ用の由来 message id（送信直前 strip）。 */
  _sourceMessageId?: string;
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
  /** @internal 送信順デバッグ用の由来 message id（送信直前 strip）。 */
  _sourceMessageId?: string;
};

/** Flex Message action (LINE 仕様の部分集合)。message / uri / postback のみ実装。 */
export type LineFlexAction =
  | { type: "message"; label?: string; text: string }
  | { type: "uri";     label?: string; uri:  string }
  | { type: "postback"; label?: string; data: string; displayText?: string };

/**
 * Flex Message。
 * contents は bubble / carousel の任意の LINE Flex コンテナ (= FlexContents)。
 * 画像 + アクション用の自動生成 (buildImageActionFlex) と、ユーザーが Simulator で
 * 作成して貼り付けた flex (message_type="flex") の両方で使う。
 */
export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: FlexContents;
  sender?: LineSender;
  quickReply?: LineQuickReply;
  _lagMs?: number;
  _timing?: MessageTimingConfig;
  /** 由来の DB Message id（送信順デバッグ用。送信直前に strip される）。 */
  _sourceMessageId?: string;
};

/**
 * 画像 + アクション用に自動生成する Flex (hero image bubble)。
 * contents の具体型を保持し、buildImageActionFlex の戻り値で使う。
 * contents は FlexContents に代入可能なため LineFlexMessage の部分型。
 */
export type ImageActionFlexMessage = {
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
  /** 由来の DB Message id（送信順デバッグ用。送信直前に strip される）。 */
  _sourceMessageId?: string;
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
  const out = text
    .replace(/\{\{user_name\}\}/g,    vars.userName    ?? "")
    .replace(/\{\{account_name\}\}/g, vars.accountName ?? "");
  // `{key}` 形式 (一重括弧) は userVariables の有無に関わらず **必ず** interpolate を通す。
  //   未定義変数 (例: `{anyName}`) や未保存の自由入力変数は空文字へ統一される。
  //   これをしないと userVariables 未設定時に literal `{key}` が残り、buildPhaseMessages の
  //   未置換 placeholder safety guard が **メッセージごと送信対象から除外**してしまう
  //   （text→text→flex の中間 text 落ち = 本不具合の原因）。interpolate(text, undefined) は
  //   全 `{key}` を空文字化する（template.ts）。二重括弧 `{{...}}` は interpolate 対象外で不変。
  return interpolate(out, vars.userVariables);
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
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 送信前待機（head / 単発メッセージの lag_ms）を解決する。
 *
 * 仕様:
 *   - `_lagMs`（= DB の lag_ms。convertMessageToLine で設定）をそのまま使う。
 *   - 0 / undefined = OFF（待機なし）。
 *   - 0 超は MAX_MSG_LAG_MS で上限クランプ。
 *
 * 従来 `replyWithLagToLine` は chain 2 通目以降にしか lag を適用せず、
 * head（= reply / 単発）の lag_ms が無視されていた（送信前待機が効かないバグ）。
 * 本関数を webhook の reply 経路から head に対して必ず通すことで、設定どおり待機させる。
 */
export function resolveHeadSendDelayMs(message: { _lagMs?: number } | null | undefined): number {
  const raw = message?._lagMs ?? 0;
  return raw > 0 ? Math.min(raw, MAX_MSG_LAG_MS) : 0;
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
//     video     → LineVideoMessage  （asset_url 必須。previewImageUrl は 専用サムネ(https)→Cloudinaryフレーム画像
//                                     →(最後の手段)asset_url の順で解決。mp4 をそのまま previewImageUrl に流用しない。
//                                     例外: asset_usage="liff_playback" のみ LINE video を送らずリンク誘導テキスト）
//   フォールバック（text 代替送信）:
//     flex / carousel / voice / riddle / 未知型
//     → alt_text or body をテキスト送信。carousel の body は JSON の可能性があるため alt_text 優先。
//   欠損時:
//     正式対応型で必須フィールドが null → warn + null（スキップ）
//     フォールバック候補もすべて null   → warn("変換不能") + null

/** 画像メッセージのタップ時アクション設定 (DB 列群を要約した形)。 */
export type ImageActionSpec = {
  type:          string | null;  // "message" | "message_with_phase" | "uri" | "liff" | "postback" | "none" | null
  text:          string | null;  // type="message" / "message_with_phase"（phase_id は payload に載せない）
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
  /** 動画の previewImageUrl 専用サムネ URL（JPEG/PNG）。null/未設定なら LINE video は送らない（mp4 を流用しない）。 */
  asset_preview_url?: string | null;
  /** メディア用途。"line_video" | "liff_playback" | "cms_preview" | null。liff_playback は LINE video 送信しない。 */
  asset_usage?: string | null;
  alt_text:   string | null;
  /** Flex Message の contents JSON (messageType="flex" のときのみ使用)。bubble/carousel または flex 全体。 */
  flexPayloadJson?: string | null;
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
}): ImageActionFlexMessage | null {
  const { imageUrl, imageAction, liffEndpointUrl } = args;
  if (!imageAction || !imageAction.type || imageAction.type === "none") return null;
  if (!imageUrl.startsWith("https://")) {
    console.warn(`[buildImageActionFlex] HTTPS URL のみ対応 (received: ${imageUrl.slice(0, 60)})`);
    return null;
  }
  let action: LineFlexAction | undefined;
  switch (imageAction.type) {
    case "message":
    case "message_with_phase":
      // どちらも LINE 上は message action（テキスト送信）。phase_id は payload に載せず、
      // webhook 側で image_action_text 受信時に遷移解決する（CMS 側保持）。
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
 * Cloudinary の動画配信URL(/video/upload/…mp4 等) から、フレーム画像(JPEG)の URL を生成する。
 * LINE video message の previewImageUrl は画像(JPEG/PNG)である必要があるため、専用サムネが無い
 * アップロード動画では mp4 をそのまま流用せず、この関数で生成した画像URLをサムネに使う。
 *
 * 例: https://res.cloudinary.com/<cloud>/video/upload/v123/name.mp4
 *   → https://res.cloudinary.com/<cloud>/video/upload/so_0,w_1280,c_limit,q_auto/v123/name.jpg
 * （so_0=先頭フレーム / w_1280,c_limit=長辺制限 / q_auto=品質自動 で previewImageUrl の 1MB 制約に収める）
 *
 * Cloudinary の video 配信URLでない、または拡張子が動画でない場合は null を返す（呼び出し元でフォールバック）。
 */
export function cloudinaryVideoPosterUrl(videoUrl: string | null | undefined): string | null {
  if (!videoUrl) return null;
  const noQuery = videoUrl.trim().split(/[?#]/)[0];
  const m = noQuery.match(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)\.(mp4|mov|webm|m4v|avi|mkv)$/i,
  );
  if (!m) return null;
  const [, base, rest] = m;
  return `${base}so_0,w_1280,c_limit,q_auto/${rest}.jpg`;
}

/**
 * 動画の previewImageUrl を解決する。
 *   1. 専用サムネ(https) があればそれを優先
 *   2. Cloudinary 動画URLなら生成したフレーム画像(JPEG)を使う（mp4 を流用しない）
 *   3. どちらも不可なら最後の手段として asset_url を使う（従来挙動・非Cloudinary アップロード等）
 */
function resolveVideoPreviewUrl(assetUrl: string, dedicatedPreview: string | null | undefined): string {
  if (dedicatedPreview && /^https:\/\//i.test(dedicatedPreview)) return dedicatedPreview;
  const poster = cloudinaryVideoPosterUrl(assetUrl);
  if (poster) return poster;
  return assetUrl;
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
  const { id, kind, mtype, body, asset_url, alt_text, flexPayloadJson, sender, quickReply, lagMs, timing } = msg;
  const assetPreviewUrl = msg.asset_preview_url ?? null;
  const assetUsage      = msg.asset_usage ?? null;
  const isPuzzle = kind === "puzzle";

  /** LINE メッセージ共通フィールドを付与するヘルパー */
  const attach = <T extends LineMessage>(m: T): T => {
    if (sender) m.sender = sender;
    if (quickReply) m.quickReply = quickReply;
    if (lagMs && lagMs > 0) m._lagMs = lagMs;
    // null は inherit。undefined と区別して扱う必要はないので、非 null/undefined のときのみセット。
    if (timing) m._timing = timing;
    // 送信順デバッグ用に由来 message id を保持（送信直前 stripInternalFields で除去）。
    if (id) m._sourceMessageId = id;
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
    if (asset_url) {
      // hotfix: アップロード済み動画・通常の動画メッセージは LINE の video message として送る（既存挙動の復旧）。
      //   previewImageUrl は専用サムネ(JPEG/PNG・https)があればそれを優先し、無ければ従来どおり
      //   動画 URL(asset_url) を流用する（アップロード済み mp4 は原則 video として直接再生させる）。
      //   PR #501 でサムネ未設定を text リンク誘導に落としていたが、既存のアップロード動画まで
      //   URL テキスト化してしまう本番不具合となったため復旧する。
      // 例外: asset_usage="liff_playback"（外部URL・大容量/200MB 超を LIFF/外部ページで再生する用途）だけは
      //   LINE video を送らず、テキスト＋リンク誘導にフォールバックする（PR #501 の外部URL/LIFF再生機能を維持）。
      if (assetUsage === "liff_playback") {
        console.info(`[${caller}] video(usage=liff_playback) は LINE video 送信せずリンク誘導 id=${id.slice(0, 8)}`);
        const base = body || alt_text || "動画はこちらからご覧いただけます";
        // asset_url が https のときのみリンクを添える（LINE がテキスト中の URL を自動リンク化する）。
        const guideText = /^https:\/\//i.test(asset_url) ? `${base}\n${asset_url}` : base;
        return attach({ type: "text", text: replacePlaceholders(truncateText(guideText), vars) } as LineTextMessage);
      }
      // previewImageUrl は専用サムネ→Cloudinaryフレーム画像→(最後の手段)asset_url の順で解決する。
      // mp4 をそのまま previewImageUrl に流用しない（Cloudinary 動画は画像フレームURLを生成）。
      const preview = resolveVideoPreviewUrl(asset_url, assetPreviewUrl);
      return attach({ type: "video", originalContentUrl: asset_url, previewImageUrl: preview } as LineVideoMessage);
    }
    // puzzle の video で asset_url が空 → body or alt_text をテキストフォールバック
    if (isPuzzle) {
      const fb = body || alt_text || "この謎を解いてください";
      console.warn(`[${caller}] puzzle video の asset_url が空のためテキストフォールバック送信 id=${id.slice(0, 8)}`);
      return attach({ type: "text", text: replacePlaceholders(fb, vars) } as LineTextMessage);
    }
    console.warn(`[${caller}] ⚠️ video メッセージの asset_url が空 id=${id.slice(0, 8)} phase=${phaseId.slice(0, 8)}`);
    return null;
  }

  // ── Flex Message（ユーザーが Simulator で作成した JSON を貼り付け）──
  // ── 通話リクエスト（flex_payload_json に設定を格納・送信時に uri ボタン付き Flex を生成）──
  //   LINE の「本物の通話リクエスト」API は使わず、tel:/URL を開く uri action ボタンの Flex を送る。
  //   設定不正/未入力のときは altText か body でテキストフォールバック（送信ゼロを避ける）。
  if (mtype === "call_request") {
    const flex = buildCallRequestFlex(flexPayloadJson, alt_text);
    if (flex) {
      return attach({ type: "flex", altText: replacePlaceholders(flex.altText, vars), contents: flex.contents as FlexContents } as LineFlexMessage);
    }
    // Flex を生成できない = 保存済み設定が空/不正 → 原因を分類してログ（本番で原因特定できる粒度・PII なし）。
    const reason = classifyCallRequestConfig(flexPayloadJson);
    const fb = alt_text || body;
    if (fb) {
      console.warn(
        `[${caller}] ⚠️ call_request の Flex を生成できずテキストフォールバック（設定 ${reason}） ` +
        `id=${id.slice(0, 8)} type=call_request phase=${phaseId.slice(0, 8)}`,
      );
      return attach({ type: "text", text: replacePlaceholders(truncateText(fb), vars) } as LineTextMessage);
    }
    // alt_text/body も無い → 送信対象から drop。実機に無言で送られない事象の唯一の drop 点なので明示ログ。
    console.warn(
      `[${caller}] ⚠️ call_request が送信できず drop（設定 ${reason}・alt_text/body も空） ` +
      `id=${id.slice(0, 8)} type=call_request phase=${phaseId.slice(0, 8)}`,
    );
    return null;
  }

  if (mtype === "flex") {
    const parts = buildFlexSendParts(flexPayloadJson, alt_text);
    if (parts) {
      return attach({ type: "flex", altText: parts.altText, contents: parts.contents } as LineFlexMessage);
    }
    // contents が不正 / 未設定 → altText か body をテキストでフォールバック（送信ゼロを避ける）
    const fb = alt_text || body;
    if (fb) {
      console.warn(`[${caller}] flex payload が不正/空のためテキストフォールバック id=${id.slice(0, 8)}`);
      return attach({ type: "text", text: replacePlaceholders(truncateText(fb), vars) } as LineTextMessage);
    }
    console.warn(`[${caller}] ⚠️ flex メッセージの payload が空 id=${id.slice(0, 8)} phase=${phaseId.slice(0, 8)}`);
    return null;
  }

  // ── カルーセル（カードタイプ式 → LINE Flex carousel。生成不能時はテキストフォールバック）──
  //   対象は「通常メッセージの carousel」のみ（kind!="puzzle"）。謎(puzzle)カルーセルは
  //   既存挙動（下の汎用テキストフォールバック）を維持し、送信形式を一切変えない。
  //   挙動安全性: 旧形式(ベア配列)/新形式(オブジェクト) どちらも normalizeCarouselContent で正規化し、
  //   buildCarouselFlex で Flex 化する。画像未設定は hero 省略・不正カードは除外・カード0/全不正なら null。
  //   例外や Flex 化不能のときは既存と同等の代替テキスト送信へフォールバックし、webhook/reply を落とさない。
  if (mtype === "carousel" && !isPuzzle) {
    try {
      const content = normalizeCarouselContent(body);
      const flex = buildCarouselFlex(content, { altText: alt_text });
      if (flex) {
        return attach({ type: "flex", altText: replacePlaceholders(flex.altText, vars), contents: flex.contents } as LineFlexMessage);
      }
      // Flex 化できない（カード0 / 全カード不正）→ 既存と同等の安全なテキストフォールバック。
      // alt_text → カード由来テキスト（生 JSON 回避）→ body（旧挙動: 非カード本文はそのまま送る）。
      const derived = content.cards.map((c) => c.title || c.name || c.description || "").find((s) => s && s.trim()) ?? "";
      const fb = alt_text || derived || body;
      if (fb) {
        console.warn(`[${caller}] carousel を Flex 化できずテキストフォールバック id=${id.slice(0, 8)}`);
        return attach({ type: "text", text: replacePlaceholders(truncateText(fb), vars) } as LineTextMessage);
      }
      console.warn(`[${caller}] ⚠️ carousel が空のため送信なし id=${id.slice(0, 8)} phase=${phaseId.slice(0, 8)}`);
      return null;
    } catch (e) {
      // 予期せぬ例外でも webhook/reply を落とさない（既存と同等の alt_text/body テキストへ）。
      console.warn(`[${caller}] carousel Flex 生成エラー → テキストフォールバック id=${id.slice(0, 8)}:`, e);
      const fb = alt_text || body;
      if (fb) return attach({ type: "text", text: replacePlaceholders(truncateText(fb), vars) } as LineTextMessage);
      return null;
    }
  }

  // ── フォールバック（voice / riddle / 未知型）──
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
  delete m._sourceMessageId;
  return m;
}

/** LINE API に渡す直前の最終送信順を構造化ログに出す（PII なし＝由来 messageId と type のみ）。 */
function logFinalDeliveryOrder(route: string, messages: LineMessage[]): void {
  console.info("[line:delivery:final-order]", JSON.stringify({
    route,
    count: messages.length,
    messageIds: messages.map((m) => m._sourceMessageId ?? null),
    types: messages.map((m) => m.type),
  }));
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

/** reply / push の送信結果。失敗を呼び出し側の集計に載せるために返す。 */
export interface LineSendResult {
  ok:      boolean;
  status:  number | null;
  /** LINE が返したエラー本文（先頭のみ）。運用ログ用。 */
  error?:  string;
}

/**
 * 送信失敗を「どのメッセージの、どのプロパティが原因か」まで含めて 1 行で出す。
 *
 * 背景: reply が 400 で拒否されても `[LINE Reply] HTTP 400` が出るだけで、
 * サマリは `failures:[]` のまま成功に見えていた。運用者は Vercel のログを
 * 直接読まない限り「届いていない」ことにすら気づけない
 * （D.O.T のカルーセルが 3 回とも 400 で消えていた / 2026-08）。
 * LINE の details[].property と CMS の messageId を並べて出し、
 * どの設定を直せばよいかをログだけで特定できるようにする。
 */
function logDeliveryFailure(args: {
  route:    "reply" | "push";
  status:   number | null;
  body:     string;
  messages: LineMessage[];
}): void {
  let lineMessage: string | null = null;
  let details: { message?: string; property?: string }[] = [];
  try {
    const parsed = JSON.parse(args.body) as { message?: string; details?: typeof details };
    lineMessage = parsed.message ?? null;
    details = Array.isArray(parsed.details) ? parsed.details : [];
  } catch { /* JSON でなければ本文をそのまま error に載せる */ }

  console.error("[line:delivery:failure]", JSON.stringify({
    route:        args.route,
    status:       args.status,
    lineMessage,
    details:      details.map((d) => ({ message: d.message, property: d.property })),
    messageCount: args.messages.length,
    types:        args.messages.map((m) => m.type),
    // CMS 上のメッセージへ辿れるようにする（どの設定を直すべきかの起点）
    sourceMessageIds: args.messages.map((m) => m._sourceMessageId ?? null),
    rawBody:      lineMessage === null ? args.body.slice(0, 300) : undefined,
  }));
}

/**
 * LINE Reply API を呼び出してメッセージを送信する。
 * 失敗してもスローせず、結果を返す
 * （Webhook は常に 200 を返す必要があるため）。
 */
export async function replyToLine(
  replyToken: string,
  messages: LineMessage[],
  channelAccessToken: string
): Promise<LineSendResult> {
  if (!replyToken || messages.length === 0) return { ok: true, status: null };

  // 最大 LINE_MSG_MAX 件に切り詰める
  const sliced = messages.slice(0, LINE_MSG_MAX);
  logFinalDeliveryOrder("reply", sliced);
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
      logDeliveryFailure({ route: "reply", status: res.status, body, messages: sliced });
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[LINE Reply] ネットワークエラー:", err);
    logDeliveryFailure({ route: "reply", status: null, body: String(err), messages: sliced });
    return { ok: false, status: null, error: String(err) };
  }
}

// ────────────────────────────────────────────────
// Push API
// ────────────────────────────────────────────────

/**
 * LINE Push API を呼び出してメッセージを送信する。
 * 内部フィールド (_lagMs) を除去してから送信する。
 * 失敗してもスローせず、コンソールにエラーを記録するだけにする。
 *
 * `options.retryKey` は **additive な任意引数**。渡したときだけ
 * `X-Line-Retry-Key` ヘッダーを付ける。3 引数で呼ぶ既存の呼び出し
 * （応答メッセージ / webhook / reply / チェックイン等）は
 * ヘッダーも挙動も従来どおりで一切変わらない。
 *
 * LINE 公式仕様（Retrying an API request）:
 *   - 値は hexadecimal UUID
 *   - **初回リクエストから付けないと再試行できない**
 *   - 同じキーの request が既に受理済みなら 409 Conflict（`x-line-accepted-request-id` が返る）
 *   - キーの有効期間は初回リクエストから 24 時間
 *   - 再試行してよいのは 500 / timeout のみ（2xx・409・その他 4xx は再試行しない）
 */
export async function pushToLine(
  userId:             string,
  messages:           LineMessage[],
  channelAccessToken: string,
  options?:           { retryKey?: string },
): Promise<{ ok: boolean; status?: number }> {
  // 送信結果を返す（成功/失敗を呼出側で判定できるようにする。
  // 既存の `await pushToLine(...)` 呼出は戻り値を無視するため後方互換）。
  if (!userId || messages.length === 0) return { ok: false };

  // 謎・問題の出題履歴を記録（push 経路：QR/Beacon/GPS/チェックイン等もここを通る・fire-and-forget）。
  void recordPuzzleDeliveries({ lineUserId: userId, sourceMessageIds: messages.map((m) => m._sourceMessageId) });

  logFinalDeliveryOrder("push", messages);
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
        // retryKey 未指定（= 既存の 3 引数呼び出し）ではヘッダー自体を付けない。
        ...(options?.retryKey ? { "X-Line-Retry-Key": options.retryKey } : {}),
      },
      body: JSON.stringify({ to: userId, messages: cleanMessages }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // LINE error body: {"message":"...","details":[{"message":"...","property":"..."}]}
      // message 本文（PII）は出さず、LINE API のエラーメッセージ（例: "You have reached your monthly limit."）のみ記録する。
      let lineMessage: string | null = null;
      try { lineMessage = (JSON.parse(body) as { message?: string })?.message ?? null; } catch { /* 非JSON */ }
      // 見つけやすい構造化ログ。push 上限超過 / token / userId 等の切り分け用（PII・本文なし）。
      console.error("[line:push:failed]", JSON.stringify({
        userId: userId.slice(0, 8),
        count: cleanMessages.length,
        status: res.status,
        lineMessage,
      }));
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[line:push:failed]", JSON.stringify({
      userId: userId.slice(0, 8),
      count: cleanMessages.length,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    }));
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
/**
 * 先頭（reply で着弾する）メッセージに CMS「入力中…」設定があれば、送信「直前」に
 * loading animation を出し、CMS 設定秒だけ待ってから返す。未設定なら loading も待機も
 * 行わない（＝即送信）。reply pacing 由来の一律 pre-delay は廃止済み。
 *
 * - loading animation は 1:1 トークのみ対象（group/room では呼ばない）。
 * - loading API 失敗は送信を止めない（ログのみ・握りつぶして続行）。
 */
/**
 * reply API の「送信前待機」の安全上限（ms）。
 *
 * 設計意図（秒数変換 と 安全上限 を混同しないこと）:
 *   - CMS の「入力中…」秒数を基本にして送信前に待つ（= 実表示時間を CMS 設定秒へ近づける）。
 *   - LINE に渡す `loadingSeconds` は別途 5 刻み切り上げ（resolveCmsLoadingPlan で算出）。
 *   - ただし replyToken は受信から約 1 分で失効するため、reply 送信前に待てるのはここまで（= 30 秒）。
 *     これを超える CMS 設定は **安全側に 30 秒へ丸める**（loadingSeconds 自体は CMS 値のまま LINE へ渡す）。
 *   - 30 秒を超える厳密な演出が必要な場合は、reply では保証できないため push 経路など別設計が必要。
 */
export const MAX_REPLY_CMS_LOADING_DELAY_MS = 30_000;

/**
 * reply 送信前の CMS loading 待機を安全上限（MAX_REPLY_CMS_LOADING_DELAY_MS）で丸める純関数。
 * 秒数変換（resolveCmsLoadingPlan）とは独立した「replyToken 保護」専用の上限処理。テスト可能。
 */
export function clampReplyCmsLoadingDelayMs(cmsDelayMs: number): { appliedDelayMs: number; clamped: boolean } {
  const safe = Math.max(0, Number.isFinite(cmsDelayMs) ? cmsDelayMs : 0);
  const appliedDelayMs = Math.min(safe, MAX_REPLY_CMS_LOADING_DELAY_MS);
  return { appliedDelayMs, clamped: appliedDelayMs < safe };
}

/**
 * 先頭（reply で着弾する）メッセージに CMS「入力中…」設定があれば、送信直前に loading を出し、
 * CMS 設定秒だけ待ってから返す。未設定なら loading も待機も行わない（= 即送信）。
 * reply 前待機は replyToken 失効回避のため MAX_REPLY_CMS_LOADING_DELAY_MS(30s) で頭打ちにする。
 */
async function applyHeadCmsLoading(
  head:               LineMessage | undefined,
  userId:             string,
  channelAccessToken: string,
  is1to1:             boolean,
  sleepFn:            (ms: number) => Promise<void>,
): Promise<{ shown: boolean; delayMs: number; loadingSeconds: number | null }> {
  if (!head || !is1to1) return { shown: false, delayMs: 0, loadingSeconds: null };
  const plan = resolveCmsLoadingPlan(head._timing);
  if (!plan) return { shown: false, delayMs: 0, loadingSeconds: null };
  let shown = false;
  try {
    await showLoadingAnimation(userId, plan.loadingSeconds, channelAccessToken, { messageId: head._sourceMessageId ?? null });
    shown = true;
  } catch {
    // loading 失敗は reply を止めない。
  }
  // replyToken 失効回避のため、reply 前待機は安全上限で頭打ちにする（切り詰めたら可視ログを残す）。
  const { appliedDelayMs, clamped } = clampReplyCmsLoadingDelayMs(plan.delayMs);
  if (clamped) {
    console.info("[line:reply-loading:clamped]", JSON.stringify({
      cmsDelayMs:     plan.delayMs,
      actualDelayMs:  appliedDelayMs,
      loadingSeconds: plan.loadingSeconds,
      clamped:        true,
      reason:         "reply_token_safety",
    }));
  }
  await sleepFn(appliedDelayMs);
  return { shown, delayMs: appliedDelayMs, loadingSeconds: plan.loadingSeconds };
}

export async function replyWithLagToLine(
  replyToken:         string,
  messages:           LineMessage[],
  userId:             string,
  channelAccessToken: string,
  controller?:        ReadReceiptController,
  /** sleep 関数（test 用に注入可能。既定は実 sleep）。reply pacing / push lag 待機に使う。 */
  sleepFn:            (ms: number) => Promise<void> = sleep,
): Promise<void> {
  if (!replyToken || messages.length === 0) return;

  // 謎・問題の出題履歴を記録（全 reply 送信経路の共通点・fire-and-forget・例外は内部で握りつぶす）。
  void recordPuzzleDeliveries({ lineUserId: userId, sourceMessageIds: messages.map((m) => m._sourceMessageId) });

  // ── 送信戦略 ──
  //  LINE Reply API は複数件を一括送信できるが、一括 Reply では message 間の
  //  lag / typing / loading / read 演出が付かず、全件ほぼ同時着になる。
  //
  //  ただし Push API は LINE 公式アカウントの月間メッセージ通数を消費する。
  //  そのため、5 件以内かつ 2 件目以降に演出設定がない場合は従来どおり Reply 一括で送る。
  //
  //  2 件目以降に演出設定がある場合のみ、
  //  「1 件目のみ Reply、2 件目以降は Push で 1 件ずつ送信」し、
  //  順番・間・演出を反映する。
  const REPLY_MAX = 5;

  // 「実際に効果が出る演出」だけを Push 分割の対象にする（= 一覧バッジ hasAnyTiming と同義）。
  // 旧実装は read_receipt_mode != null / read_delay_ms>0 を effect 扱いしていたため、
  // 即時(immediate)=OFF や残存 read_delay でも 2 通目が Push 化され、Push 失敗(月間上限等)で
  // 2 通目が実機に届かない事故を招いていた。OFF 相当は Reply 一括で送る。
  const hasTimingEffect = (m: LineMessage): boolean => {
    const timing = m._timing;
    return (
      (m._lagMs ?? 0) > 0 ||
      timing?.typing_enabled === true ||
      timing?.loading_enabled === true ||
      timing?.read_receipt_mode === "delayed" ||
      timing?.read_receipt_mode === "before_reply"
    );
  };

  const needsSequentialPush = messages.slice(1).some(hasTimingEffect);

  // 5 件以内で、2 件目以降に演出がない場合は Push 消費を避けて Reply 一括。
  if (messages.length <= REPLY_MAX && !needsSequentialPush) {
    // CMS「入力中…」設定に従う:
    //   先頭メッセージに loading 設定があれば、送信直前に loading を出して CMS 設定秒だけ待つ。
    //   未設定なら loading も待機も入れず即送信する（reply pacing 由来の一律 pre-delay は廃止）。
    const is1to1 = controller ? controller.isOneToOne : !!userId;
    const loadingInfo = await applyHeadCmsLoading(messages[0], userId, channelAccessToken, is1to1, sleepFn);
    console.info("[line:reply-loading]", JSON.stringify({
      cmsLoading: loadingInfo.shown,
      delayMs:    loadingInfo.delayMs,
      loadingSeconds: loadingInfo.loadingSeconds,
      messageCount: messages.length,
    }));

    const replyResult = await replyToLine(replyToken, messages, channelAccessToken);
    // reply が 400 等で拒否された場合、以前はサマリが failures:[] のままで
    // 「送れた」ように見えていた。失敗を必ず集計に載せる。
    const replyFailed = replyResult?.ok === false;
    console.info("[line:reply-lag:summary]", JSON.stringify({
      strategy:   messages.length === 1 ? "reply_one" : "reply_all",
      reason:     loadingInfo.shown ? "cms_loading_head" : "no_timing_effect",
      replyTotal: messages.length,
      replyOk:    replyFailed ? 0 : messages.length,
      replyFail:  replyFailed ? messages.length : 0,
      pushTotal:  0,
      pushOk:     0,
      pushFail:   0,
      failures:   replyFailed
        ? [{ route: "reply", status: replyResult?.status ?? null,
             msgIds: messages.map((m) => m._sourceMessageId ?? null) }]
        : [],
    }));
    if (replyFailed) {
      console.error(
        `[replyWithLagToLine] ⚠️ reply 送信失敗 status=${replyResult?.status ?? "-"} msgs=${messages.length}件 → ユーザーには1通も届いていない`,
      );
    }
    console.log(`[replyWithLagToLine] strategy=${messages.length === 1 ? "reply_one" : "reply_all"} reply=${messages.length} push=0 total=${messages.length}`);
    return;
  }

  const replyBatch = needsSequentialPush ? [messages[0]!] : messages.slice(0, REPLY_MAX);
  const pushRest   = needsSequentialPush ? messages.slice(1) : messages.slice(REPLY_MAX);

  console.log(
    `[diag][timing-sequence] count=${messages.length} needsSequentialPush=${needsSequentialPush} ids=[${messages.map((m) => idOf(m)).join(",")}]`,
  );

  // 先頭（reply）メッセージに CMS「入力中…」設定があれば、reply 送信直前に loading+CMS秒待機する。
  // 未設定なら何もしない（push 経路の 2 通目以降は従来どおり showLoadingForMessage が個別に担う）。
  {
    const is1to1 = controller ? controller.isOneToOne : !!userId;
    await applyHeadCmsLoading(replyBatch[0], userId, channelAccessToken, is1to1, sleepFn);
  }

  const replyResult = await replyToLine(replyToken, replyBatch, channelAccessToken);
  const replyFailed = replyResult?.ok === false;

  if (controller && pushRest.length > 0) {
    controller.abortPendingLoading();
    console.log(`[diag][timing-loading-abort] push 送信開始のため webhook scheduleLoading を abort`);
  }

  let pushOk = 0;
  let pushFail = 0;
  const pushFailures: { route?: string; idx: number; msgId: string | null; status: number | null }[] = [];
  if (replyFailed) {
    // reply バッチ（先頭〜5通）が丸ごと届いていない。push の失敗と同じ土俵に載せる。
    replyBatch.forEach((m, i) => pushFailures.push({
      route: "reply", idx: i + 1,
      msgId: m._sourceMessageId ?? null,
      status: replyResult?.status ?? null,
    }));
  }

  for (let i = 0; i < pushRest.length; i++) {
    const msg = pushRest[i];
    const msgId = msg._sourceMessageId ?? null;
    const rawLag = msg._lagMs ?? 0;
    const delay = rawLag > 0 ? Math.min(rawLag, MAX_MSG_LAG_MS) : DEFAULT_MSG_LAG_MS;

    console.log(
      `[diag][timing-send-before] msg=${idOf(msg)} waitLag=${delay}ms`,
      `lagSource=${msg._lagMs != null ? "_lagMs" : "default"}`,
    );

    await sleepFn(delay);

    if (controller && msg._timing) {
      await controller.waitTypingForMessage(msg._timing);
      await controller.showLoadingForMessage(msg._timing, { messageId: msg._sourceMessageId ?? null });
    }

    const result = await pushToLine(userId, [msg], channelAccessToken);

    if (result.ok) {
      pushOk++;
    } else {
      pushFail++;
      pushFailures.push({ idx: replyBatch.length + i + 1, msgId, status: result.status ?? null });
    }

    console.log(`[diag][timing-send-after] msg=${idOf(msg)} pushed=${result.ok}`);
  }

  const strategy = needsSequentialPush
    ? "reply_first_push_rest"
    : "reply_first_5_push_rest";

  console.info("[line:reply-lag:summary]", JSON.stringify({
    strategy,
    reason:     needsSequentialPush ? "preserve_message_order_and_timing" : "line_reply_limit_5",
    replyTotal: replyBatch.length,
    replyOk:    replyFailed ? 0 : replyBatch.length,
    replyFail:  replyFailed ? replyBatch.length : 0,
    pushTotal:  pushRest.length,
    pushOk,
    pushFail,
    failures:   pushFailures,
  }));

  if (replyFailed) {
    console.error(
      `[replyWithLagToLine] ⚠️ reply 送信失敗 status=${replyResult?.status ?? "-"} msgs=${replyBatch.length}件 → 先頭バッチが届いていない`,
    );
  }
  console.log(`[replyWithLagToLine] strategy=${strategy} reply=${replyBatch.length}(fail=${replyFailed ? replyBatch.length : 0}) push=${pushRest.length}(ok=${pushOk}/fail=${pushFail}) total=${messages.length}`);
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
 * - action: "text" / "next" / "custom" → 送信先（target_message_id / response_message_id /
 *     target_phase_id）を持ち qrPostbackSourceMessageId 指定時は **postback**（action=quick_reply）。
 *     それ以外（送信先なし or 未指定）は message アクション（タップ時にラベル送信＝既存互換）。
 * - action: "url"                       → uri アクション（URL を開く）
 * - action: "hint"                      → sourceMessageId 指定時は puzzle_hint postback、未指定は message
 * - items が空の場合は undefined を返す
 */
export function buildQuickReplyFromItems(
  items: QuickReplyItem[],
  opts?: {
    resolveDestinationUrl?: (destinationId: string) => string | null;
    /**
     * 指定時、hint アイテムを **postback**（action=puzzle_hint&messageId=<this>&hintIndex=<n>）として
     * 出力する。これによりタップ時はラベルテキストでなく「紐づく問題 messageId + ヒント index」が届き、
     * 同フェーズに同名ヒントの問題が複数あってもタップ元の問題のヒントへ解決できる。
     * 未指定（旧来）の場合は hint も message action（label 送信）のまま＝既存互換。
     * hintIndex は resolveDisplayQrItems の hint 並び順（= resolveHintItems）と一致する。
     */
    sourceMessageId?: string;
    /**
     * 指定時、**送信先を持つ通常 QR**（text/next/custom かつ target_message_id /
     * response_message_id / target_phase_id のいずれかを持つ）を **postback**
     * （action=quick_reply&sourceMessageId=<this>&qrIndex=<index>）として出力する。
     * qrIndex は **items 内の元 index**（= 呼び出し側が渡す resolveDisplayQrItems 出力の index）。
     * webhook 側は resolveQuickReplyItem(row, qrIndex) で同じ index を引き当て、ラベル一致に
     * 依存せず正しい送信先へ解決する（同名 QR が複数あっても取り違えない）。
     * 送信先を持たない純フリーテキスト QR は対象外（= message action のまま・keyword/transition に委ねる）。
     */
    qrPostbackSourceMessageId?: string;
  },
): LineQuickReply | undefined {
  if (!items || items.length === 0) return undefined;

  let hintIdx = 0; // hint アイテムの出現順 index（postback hintIndex 用）。非 hint では増えない。
  const lineItems: LineQuickReplyItem[] = items
    .map((item, qrIndex) => ({ item, qrIndex }))  // qrIndex = items 内の元 index（filter/slice 前）
    .filter(({ item }) => item.enabled !== false) // enabled=false のアイテムを除外
    .slice(0, QUICK_REPLY_MAX)
    .flatMap(({ item, qrIndex }): LineQuickReplyItem[] => {
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
      if (item.action === "hint") {
        const thisHintIdx = hintIdx++;
        // sourceMessageId があれば postback 化（解決キー = messageId + hintIndex・ラベル非依存）。
        if (opts?.sourceMessageId) {
          return [{
            type: "action",
            action: {
              type:        "postback",
              label,
              data:        buildPuzzleHintPostbackData(opts.sourceMessageId, thisHintIdx),
              displayText: item.label,
            },
          }];
        }
        // legacy: ラベルを送信テキストにする message action（旧データ互換・matchHintFromPhase が処理）。
        return [{ type: "action", action: { type: "message", label, text: item.label } }];
      }
      // text / next / custom → value 優先、なければ label
      const text = item.value?.trim() || item.label;
      // 送信先を持つ通常 QR は postback 化（解決キー = sourceMessageId + qrIndex・ラベル非依存）。
      // displayText には従来の送信テキストを入れ、LINE 上は「次へ」を送ったように見せる（見た目不変）。
      if (opts?.qrPostbackSourceMessageId && quickReplyItemHasDestination(item)) {
        return [{
          type: "action",
          action: {
            type:        "postback",
            label,
            data:        buildQuickReplyPostbackData(opts.qrPostbackSourceMessageId, qrIndex),
            displayText: text,
          },
        }];
      }
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
    // 通常 QR ＋ 問題（puzzle）のヒント QR（incorrect_quick_replies）を解決する。
    // hint_mode="always" のとき、問題メッセージ自体にヒント QR を付与する（タップで matchHintFromPhase が応答）。
    const visibleQrItems = resolveDisplayQrItems({
      kind:                  msg.kind,
      hintMode:              msg.hint_mode,
      quickReplies:          msg.quick_replies,
      incorrectQuickReplies: msg.incorrect_quick_replies,
    });
    const msgQr = visibleQrItems.length
      // 送信先を持つ通常 QR は postback 化（sourceMessageId + qrIndex で解決・同名 QR の取り違え防止）。
      // 問題（puzzle）のヒント QR は puzzle_hint postback（messageId + hintIndex）も併せて付与。
      ? buildQuickReplyFromItems(visibleQrItems, {
          qrPostbackSourceMessageId: msg.id,
          ...(msg.kind === "puzzle" ? { sourceMessageId: msg.id } : {}),
        })
      : undefined;
    return convertMessageToLine({
      id:        msg.id,
      kind:      msg.kind,
      mtype:     msg.message_type as string,
      body:      msg.body,
      asset_url: msg.asset_url,
      asset_preview_url: msg.asset_preview_url ?? null,
      asset_usage:       msg.asset_usage ?? null,
      alt_text:  msg.alt_text,
      flexPayloadJson: msg.flex_payload_json,
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
  // QuickReply もユーザー操作待ち（選択肢提示）の送信単位境界。QR を含む chain を送ったら
  // phase iteration を停止し、後続の独立 head（QR 選択後に送るべきメッセージ）は送らない。
  // (= freeInput と同じセマンティクス。これがないと開始/フェーズ遷移時に後続 head まで一括送信され、
  //  LINE は最後のメッセージの quickReply しか表示しないため QR が出ず、順序も崩れる。)
  let stoppedAtQuickReply = false;
  // placeholder safety guard の例外集合: freeInputEnabled=true の prompt 由来 LineMessage は
  // 未置換 placeholder を含んでいても除外しない (= ユーザー入力前に出すプロンプト本体は
  // 必ず送る必要があるため)。WeakSet で identity 比較する。
  const freeInputPromptLineMsgs = new WeakSet<LineMessage>();
  for (const head of phase.messages) {
    if (stoppedAtFreeInput || stoppedAtQuickReply) break;
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

    // この chain が QuickReply（ユーザー選択待ち）を含むなら phase iteration を停止する。
    // QR 提示後の後続 head はユーザー選択後に送るべきで、ここで一括送信してはいけない
    // (= freeInput と同じ境界。LINE は最後のメッセージの quickReply しか表示しないため、
    //  後続を送ると QR が隠れて順序も崩れる)。
    if (chainMessages.some((m) => (m as { quickReply?: LineQuickReply }).quickReply)) {
      stoppedAtQuickReply = true;
      console.log(
        `[buildPhaseMessages] STOP at quick_reply head=${head.id.slice(0, 8)} sort=${head.sort_order} ` +
        `(QR 提示でユーザー選択待ち。後続の独立 head は選択後に送るのが正しい仕様)`,
      );
    }
  }

  // ── サマリログ ──
  const prefixOffset = prefixText ? 1 : 0;
  logConversionSummary("buildPhaseMessages", phase.id, inputCount, messages.length - prefixOffset);

  // 送信順の決定論ログ（phase.messages は sortOrder→createdAt→id で取得済み。実機順調査用）。
  console.info("[line:delivery:order]", JSON.stringify({
    source: "buildPhaseMessages",
    phaseId: phase.id,
    messageIds: phase.messages.map((m) => m.id),
    sortOrders: phase.messages.map((m) => m.sort_order ?? null),
  }));

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
  /** 動画の previewImageUrl 専用サムネ URL（JPEG/PNG）。null なら LINE video 送信しない（mp4 流用しない）。 */
  assetPreviewUrl?: string | null;
  /** メディア用途。"line_video" | "liff_playback" | "cms_preview" | null。liff_playback は LINE video 送信しない。 */
  assetUsage?:     string | null;
  altText:         string | null;
  flexPayloadJson: string | null;
  /** DB の quickReplies カラム（JSON 文字列）。parse して LineQuickReply に変換する */
  quickReplies:    string | null;
  /** メッセージ種別。kind="puzzle" のとき incorrectQuickReplies からヒント QR を合成する */
  kind?:           string | null;
  /** ヒント表示モード（"always" | "on_wrong" | "hidden"）。buildPhaseMessages と同じ判定に使う */
  hintMode?:       string | null;
  /** DB の incorrect_quick_replies カラム（JSON 文字列・action="hint"）。問題メッセージのヒント QR */
  incorrectQuickReplies?: string | null;
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

    // 表示用クイックリプライを buildPhaseMessages と同じヘルパーで解決する。
    // 通常 QR (quickReplies) ＋ 問題（kind="puzzle" / hint_mode）のヒント QR (incorrectQuickReplies)
    // を合成する。これにより target_message_id 経由で puzzle を送る場合もヒント QR が付く。
    const parseQrJson = (raw: string | null | undefined, field: string): QuickReplyItem[] | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as QuickReplyItem[]) : null;
      } catch {
        console.warn(`[buildKeywordMessages] ${field} JSON parse error msgId=${msg.id}`);
        return null;
      }
    };
    const displayQrItems = resolveDisplayQrItems({
      kind:                  msg.kind ?? "normal",
      hintMode:              msg.hintMode,
      quickReplies:          parseQrJson(msg.quickReplies, "quickReplies"),
      incorrectQuickReplies: parseQrJson(msg.incorrectQuickReplies, "incorrectQuickReplies"),
    });
    const msgQr: LineQuickReply | undefined =
      displayQrItems.length
        // 送信先を持つ通常 QR は postback 化（sourceMessageId + qrIndex）。同名 QR の取り違え防止。
        // 問題（puzzle）のヒント QR は puzzle_hint postback（messageId + hintIndex）も併せて付与。
        ? buildQuickReplyFromItems(displayQrItems, {
            qrPostbackSourceMessageId: msg.id,
            ...(msg.kind === "puzzle" ? { sourceMessageId: msg.id } : {}),
          })
        : undefined;

    // 共通変換ヘルパー（buildPhaseMessages と同一ロジック）
    const lineMsg = convertMessageToLine({
      id:        msg.id,
      mtype:     msg.messageType as string,
      body:      msg.body,
      asset_url: msg.assetUrl,
      asset_preview_url: msg.assetPreviewUrl ?? null,
      asset_usage:       msg.assetUsage ?? null,
      alt_text:  msg.altText,
      flexPayloadJson: msg.flexPayloadJson,
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

  // 送信順の決定論ログ（実機順とのズレ調査用。PII は出さない＝id/sortOrder のみ）。
  console.info("[line:delivery:order]", JSON.stringify({
    source: "buildKeywordMessages",
    messageIds: records.map((r) => r.id),
    sortOrders: records.map((r) => r.sortOrder ?? null),
  }));

  // LINE は最後のメッセージの quickReply のみ表示する仕様のため、
  // 中間メッセージに quickReply が設定されていたら最後のメッセージに移動する。
  // (= chain head の QR は chain tail で表示される。buildPhaseMessages と同じ挙動)
  const sliced = messages.slice(0, LINE_MSG_MAX);
  moveQuickReplyToTail(sliced as { quickReply?: LineQuickReply }[]);
  return sliced;
}

/**
 * head 群の nextMessageId 連鎖（= 連続送信の継続メッセージ）を辿り、
 * `[head, ...継続]` の順に並べた KeywordMessageRecord[] を返す。
 *
 * 背景: buildKeywordMessages は渡された records を順に変換するだけで chain walk しない。
 *   一方、開始(kind="start")メッセージの取得は kind="start" のみを fetch するため、
 *   継続メッセージ(kind="normal" など)が送信対象から漏れていた（= 実機で2通目が届かない）。
 *   buildPhaseMessages は phase 内 walk で両方含めるため、本関数で挙動を揃える。
 *
 * 純関数（DB 非依存）。継続メッセージの取得は呼び出し側が `fetchById` で注入する。
 * 停止条件: freeInputEnabled（そのメッセージを含めて停止）/ 循環 / fetch=null / cap 到達。
 */
export async function expandKeywordChain(
  heads:     KeywordMessageRecord[],
  fetchById: (id: string) => Promise<KeywordMessageRecord | null>,
  cap:       number = LINE_MSG_MAX,
): Promise<KeywordMessageRecord[]> {
  const out:  KeywordMessageRecord[] = [];
  const seen = new Set<string>();
  for (const head of heads) {
    if (seen.has(head.id)) continue;
    out.push(head);
    seen.add(head.id);
    let cur: KeywordMessageRecord = head;
    // freeInput プロンプトは「そのメッセージで停止」セマンティクスのため walk しない。
    while (
      out.length < cap &&
      cur.nextMessageId != null &&
      !cur.freeInputEnabled &&
      !seen.has(cur.nextMessageId)
    ) {
      const next = await fetchById(cur.nextMessageId);
      if (!next) break;
      out.push(next);
      seen.add(next.id);
      cur = next;
    }
  }
  return out;
}
