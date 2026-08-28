// src/lib/line-richmenu.ts
// LINE Rich Menu API クライアント + PNG 生成ユーティリティ
//
// LINE Rich Menu API リファレンス:
//   https://developers.line.biz/ja/reference/messaging-api/#rich-menu
//
// 提供機能:
//   - generateRichMenuPng()    — 外部ライブラリ不要の 2500×843 PNG 生成
//   - createRichMenu()         — リッチメニュー JSON を LINE API に登録
//   - uploadRichMenuImage()    — PNG バイナリをリッチメニューにアップロード
//   - setDefaultRichMenu()     — チャンネル全体のデフォルトに設定
//   - cancelDefaultRichMenu()  — デフォルトを解除
//   - deleteRichMenu()         — リッチメニューを削除
//   - getRichMenuStatus()      — 登録済みリッチメニューの情報を取得

import { deflateSync } from "zlib";
import { RICHMENU_ACTIONS } from "./line";

// ────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────

const LINE_API_BASE      = "https://api.line.me/v2/bot";
const LINE_API_DATA_BASE = "https://api-data.line.me/v2/bot";

// リッチメニューサイズ（LINE 推奨: 1 段 = 2500×843）
const RM_WIDTH  = 2500;
const RM_HEIGHT = 843;

// ────────────────────────────────────────────────
// PNG 生成（外部依存なし）
// ────────────────────────────────────────────────

/** CRC32 ルックアップテーブル（PNG チャンク用） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): Buffer {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 0);
  return out;
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  return Buffer.concat([u32be(data.length), t, data, crc32(Buffer.concat([t, data]))]);
}

/**
 * 3 分割カラー PNG を生成する（LINE リッチメニュー 2500×843 px）。
 * 外部ライブラリ不要。zlib (Node.js 組み込み) のみ使用。
 *
 * @param colors [左, 中, 右] の RGB タプル配列。省略時はデフォルト配色。
 */
export function generateRichMenuPng(
  colors: [[number, number, number], [number, number, number], [number, number, number]] = [
    [34,  197, 94],   // 緑  — はじめる
    [59,  130, 246],  // 青  — つづきから
    [239, 68,  68],   // 赤  — リセット
  ]
): Buffer {
  const W = RM_WIDTH, H = RM_HEIGHT;
  const B1 = Math.floor(W / 3);       // 833
  const B2 = Math.floor(W * 2 / 3);   // 1666

  // 1行分のピクセルデータを生成（フィルタバイト 0 + RGB×W）
  const rowLen = 1 + W * 3;
  const rowBuf = Buffer.alloc(rowLen);
  rowBuf[0] = 0; // filter type: None
  for (let x = 0; x < W; x++) {
    const ci = x < B1 ? 0 : x < B2 ? 1 : 2;
    const [r, g, b] = colors[ci];
    const p = 1 + x * 3;
    rowBuf[p] = r; rowBuf[p + 1] = g; rowBuf[p + 2] = b;
  }

  // 全行を rawBuf にコピー（同一行の繰り返し → zlib で高効率圧縮）
  const rawBuf = Buffer.allocUnsafe(rowLen * H);
  for (let y = 0; y < H; y++) rowBuf.copy(rawBuf, y * rowLen);

  // PNG バイナリ組み立て
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = pngChunk("IHDR", Buffer.concat([
    u32be(W), u32be(H),
    Buffer.from([8, 2, 0, 0, 0]), // bitDepth=8, colorType=2(RGB)
  ]));
  const idat = pngChunk("IDAT", deflateSync(rawBuf, { level: 6 }));
  const iend = pngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ────────────────────────────────────────────────
// LINE Rich Menu API 型定義
// ────────────────────────────────────────────────

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action:
    | { type: "postback"; label: string; data: string; displayText?: string }
    | { type: "message";  label: string; text: string }
    | { type: "uri";      label: string; uri: string };
}

export interface RichMenuConfig {
  size:        { width: number; height: number };
  selected:    boolean;
  name:        string;
  chatBarText: string;
  areas:       RichMenuArea[];
}

// ────────────────────────────────────────────────
// デフォルトリッチメニュー設定（3ボタン: はじめる / つづきから / リセット）
// ────────────────────────────────────────────────

/**
 * OA の基本リッチメニュー設定を返す。
 * ボタンタップ時は postback を送信（チャットに表示されるテキストは displayText）。
 */
export function buildBasicRichMenuConfig(): RichMenuConfig {
  const W = RM_WIDTH, H = RM_HEIGHT;
  const sectionW = Math.floor(W / 3); // 833

  return {
    size:        { width: W, height: H },
    selected:    true,
    name:        "基本アクションメニュー",
    chatBarText: "メニュー",
    areas: [
      {
        bounds: { x: 0,               y: 0, width: sectionW,         height: H },
        action: {
          type:        "postback",
          label:       "はじめる",
          data:        RICHMENU_ACTIONS.START,
          displayText: "はじめる",
        },
      },
      {
        bounds: { x: sectionW,        y: 0, width: sectionW,         height: H },
        action: {
          type:        "postback",
          label:       "つづきから",
          data:        RICHMENU_ACTIONS.CONTINUE,
          displayText: "つづきから",
        },
      },
      {
        bounds: { x: sectionW * 2,    y: 0, width: W - sectionW * 2, height: H },
        action: {
          type:        "postback",
          label:       "リセット",
          data:        RICHMENU_ACTIONS.RESET,
          displayText: "リセット",
        },
      },
    ],
  };
}

// ────────────────────────────────────────────────
// LINE API ヘルパー
// ────────────────────────────────────────────────

async function lineRequest(
  method: "GET" | "POST" | "DELETE",
  url: string,
  token: string,
  body?: unknown,
  contentType = "application/json"
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  let reqBody: BodyInit | undefined;

  if (body instanceof Buffer) {
    headers["Content-Type"] = contentType;
    reqBody = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    reqBody = JSON.stringify(body);
  }

  return fetch(url, { method, headers, body: reqBody });
}

async function parseLineResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = `LINE API HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg += `: ${j.message}`;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

import {
  RICH_MENU_IMAGE_MAX_BYTES,
  RICH_MENU_IMAGE_MIME_TYPES,
  RICH_MENU_IMAGE_MAX_LABEL,
  formatBytesAsMb,
  type RichMenuImageMimeType,
} from "@/lib/constants/richmenu";

// ────────────────────────────────────────────────
// 公開 API 関数
// ────────────────────────────────────────────────

// 画像制約は client からも参照するため独立モジュールに置いてある。ここでは再 export する。
export { RICH_MENU_IMAGE_MAX_BYTES, RICH_MENU_IMAGE_MIME_TYPES } from "@/lib/constants/richmenu";

/**
 * リッチメニューを LINE に登録し、richMenuId を返す。
 */
export async function createRichMenu(
  channelAccessToken: string,
  config?: RichMenuConfig
): Promise<string> {
  const body = config ?? buildBasicRichMenuConfig();
  const res = await lineRequest(
    "POST",
    `${LINE_API_BASE}/richmenu`,
    channelAccessToken,
    body
  );
  const data = await parseLineResponse<{ richMenuId: string }>(res);
  return data.richMenuId;
}


/**
 * 画像バイナリをリッチメニューにアップロードする。
 * LINE 要件: PNG/JPEG, 最大 1 MB（RICH_MENU_IMAGE_MAX_BYTES）。
 */
export async function uploadRichMenuImage(
  channelAccessToken: string,
  richMenuId: string,
  imageBuffer: Buffer,
  mimeType: string = "image/png"
): Promise<void> {
  const res = await lineRequest(
    "POST",
    `${LINE_API_DATA_BASE}/richmenu/${richMenuId}/content`,
    channelAccessToken,
    imageBuffer,
    mimeType
  );
  await parseLineResponse(res);
}

/**
 * チャンネル全体のデフォルトリッチメニューに設定する。
 * 設定後は全ユーザーのトーク画面に表示される。
 */
export async function setDefaultRichMenu(
  channelAccessToken: string,
  richMenuId: string
): Promise<void> {
  const res = await lineRequest(
    "POST",
    `${LINE_API_BASE}/user/all/richmenu/${richMenuId}`,
    channelAccessToken
  );
  await parseLineResponse(res);
}

/**
 * チャンネル全体のデフォルトリッチメニュー ID を取得する。
 * 未設定なら null（LINE は 404 + "no default richmenu" を返す）。
 *
 * setDefault の 200 だけを成功根拠にせず、実際に反映されたかを read-back するために使う。
 */
export async function getDefaultRichMenuId(
  channelAccessToken: string
): Promise<string | null> {
  const res = await lineRequest(
    "GET",
    `${LINE_API_BASE}/user/all/richmenu`,
    channelAccessToken
  );
  if (res.status === 404) return null; // no default richmenu
  const data = await parseLineResponse<{ richMenuId?: string }>(res);
  return data.richMenuId ?? null;
}

/**
 * リッチメニューの画像がアップロード済みかを確認する。
 *
 * 画像未アップロードのメニューは default 化できない（LINE が 400 を返す）。
 * 「upload API が 200 だった」だけでなく、実際に content が引けることを確かめる。
 */
export async function richMenuImageExists(
  channelAccessToken: string,
  richMenuId: string
): Promise<boolean> {
  const res = await lineRequest(
    "GET",
    `${LINE_API_DATA_BASE}/richmenu/${richMenuId}/content`,
    channelAccessToken
  );
  return res.ok;
}

/**
 * チャンネルのデフォルトリッチメニューを解除する。
 */
export async function cancelDefaultRichMenu(
  channelAccessToken: string
): Promise<void> {
  const res = await lineRequest(
    "DELETE",
    `${LINE_API_BASE}/user/all/richmenu`,
    channelAccessToken
  );
  // 204 No Content の場合もあるので、エラー時のみ投げる
  if (!res.ok && res.status !== 404) {
    await parseLineResponse(res);
  }
}

/**
 * リッチメニューを LINE から削除する。
 */
export async function deleteRichMenu(
  channelAccessToken: string,
  richMenuId: string
): Promise<void> {
  const res = await lineRequest(
    "DELETE",
    `${LINE_API_BASE}/richmenu/${richMenuId}`,
    channelAccessToken
  );
  if (!res.ok && res.status !== 404) {
    await parseLineResponse(res);
  }
}

/**
 * LINE に登録されているリッチメニュー情報を取得する。
 * 存在しない場合は null を返す。
 */
export async function getRichMenuStatus(
  channelAccessToken: string,
  richMenuId: string
): Promise<{ richMenuId: string; name: string; chatBarText: string } | null> {
  const res = await lineRequest(
    "GET",
    `${LINE_API_BASE}/richmenu/${richMenuId}`,
    channelAccessToken
  );
  if (res.status === 404) return null;
  return parseLineResponse(res);
}

/**
 * 現在のデフォルトリッチメニューの「所有者まで含めた」状態を取得する。
 *
 * `getDefaultRichMenuId()` は 404 のみを null に畳むため、403 では throw する。
 * LINE ではデフォルトリッチメニューを **Messaging API** と
 * **LINE Official Account Manager** のどちらでも設定でき、後者が保持している場合
 * この API は 403 (`the richmenu is owned by another channel`) を返す。
 * その場合 Messaging API 側からは取得も解除もできないため、**触ってはいけない**。
 *
 * 削除時に「解除してよいデフォルトか」を判断するために使う。
 *
 * @see https://developers.line.biz/ja/reference/messaging-api/#get-default-rich-menu-id
 */
export type DefaultRichMenuState =
  /** Messaging API で設定したデフォルトが存在する */
  | { kind: "ours"; richMenuId: string }
  /** デフォルト未設定 (404) */
  | { kind: "none" }
  /** OA Manager 等、別チャネルがデフォルトを保持している (403)。こちらからは操作不可 */
  | { kind: "other-channel" };

export async function getDefaultRichMenuState(
  channelAccessToken: string
): Promise<DefaultRichMenuState> {
  const res = await lineRequest(
    "GET",
    `${LINE_API_BASE}/user/all/richmenu`,
    channelAccessToken
  );
  if (res.status === 404) return { kind: "none" };
  if (res.status === 403) return { kind: "other-channel" };
  const data = await parseLineResponse<{ richMenuId?: string }>(res);
  return data.richMenuId
    ? { kind: "ours", richMenuId: data.richMenuId }
    : { kind: "none" };
}

export interface DeleteRichMenuFromLineResult {
  /** このメニューがデフォルトだったため解除したか */
  defaultCancelled: boolean;
  /** LINE 側に既に存在せず 404 だったか（＝冪等に成功扱い） */
  alreadyAbsent: boolean;
}

/**
 * リッチメニューを LINE 側から取り除く（デフォルト解除 → メニュー削除）。
 *
 * CMS の「削除」から呼ぶ。DB レコードだけを消すと LINE 側にはメニュー本体も
 * デフォルト設定も残り、「CMS で削除したのに LINE アプリには古いリッチメニューが
 * 表示され続ける」状態になる（D.O.T / 2026-08 で実際に発生）。
 * **DB を消す前に必ずこちらを成功させること。**
 *
 * 意図的にやらないこと:
 *   - **per-user リンクの一括解除はしない**。ユーザー単位のリッチメニュー切替
 *     (`linkRichMenuToUser` / visible_phase) は正式仕様であり、デフォルトの
 *     更新とは意味が違う。リンク済みユーザーには、LINE の仕様どおり
 *     「トーク画面に再入室したとき」に削除が反映される。
 *   - **OA Manager 側のデフォルトには触らない**（403 = other-channel なら解除をスキップ）。
 *   - **別メニューがデフォルトのときに解除しない**（無関係なメニューを巻き込まない）。
 *
 * @throws LINE API がエラーを返した場合。呼び出し側は DB を変更せずに中断すること。
 */
export async function deleteRichMenuFromLine(params: {
  token:          string;
  lineRichMenuId: string;
  logPrefix?:     string;
}): Promise<DeleteRichMenuFromLineResult> {
  const prefix = params.logPrefix ?? "[deleteRichMenuFromLine]";

  // ── 1. このメニューがデフォルトなら解除する ──
  let defaultCancelled = false;
  const current = await getDefaultRichMenuState(params.token);
  if (current.kind === "ours" && current.richMenuId === params.lineRichMenuId) {
    await cancelDefaultRichMenu(params.token);
    defaultCancelled = true;
  }
  console.log(
    `${prefix} default=${current.kind}${current.kind === "ours" ? `:${current.richMenuId}` : ""} ` +
    `cancelled=${defaultCancelled}`
  );

  // ── 2. メニュー本体を削除する ──
  const res = await lineRequest(
    "DELETE",
    `${LINE_API_BASE}/richmenu/${params.lineRichMenuId}`,
    params.token
  );
  const alreadyAbsent = res.status === 404;
  if (!res.ok && !alreadyAbsent) {
    // parseLineResponse が LINE のエラーメッセージ付きで throw する
    await parseLineResponse(res);
  }
  console.log(
    `${prefix} deleted ${params.lineRichMenuId} (${alreadyAbsent ? "already_absent" : "ok"})`
  );

  return { defaultCancelled, alreadyAbsent };
}

/**
 * 特定ユーザーにリッチメニューをリンクする。
 * ユーザーが特定のフェーズに進んだときに呼び出す。
 */
export async function linkRichMenuToUser(
  channelAccessToken: string,
  userId:             string,
  richMenuId:         string,
): Promise<void> {
  const res = await lineRequest(
    "POST",
    `${LINE_API_BASE}/user/${userId}/richmenu/${richMenuId}`,
    channelAccessToken,
  );
  if (!res.ok && res.status !== 404) {
    await parseLineResponse(res);
  }
}

/**
 * 特定ユーザーからリッチメニューのリンクを解除する（デフォルトに戻す）。
 */
export async function unlinkRichMenuFromUser(
  channelAccessToken: string,
  userId:             string,
): Promise<void> {
  const res = await lineRequest(
    "DELETE",
    `${LINE_API_BASE}/user/${userId}/richmenu`,
    channelAccessToken,
  );
  if (!res.ok && res.status !== 404) {
    await parseLineResponse(res);
  }
}

/**
 * ワンストップでリッチメニューを作成・画像アップロード・デフォルト設定する。
 * @returns 作成した richMenuId
 */
export async function applyBasicRichMenu(
  channelAccessToken: string
): Promise<string> {
  // 1. メニュー構成を登録
  const richMenuId = await createRichMenu(channelAccessToken);

  // 2. PNG 画像をアップロード
  const png = generateRichMenuPng();
  await uploadRichMenuImage(channelAccessToken, richMenuId, png);

  // 3. チャンネルのデフォルトに設定
  await setDefaultRichMenu(channelAccessToken, richMenuId);

  return richMenuId;
}

// ────────────────────────────────────────────────
// カスタムリッチメニュー共通適用ロジック
// ────────────────────────────────────────────────

/** apply のどの段で失敗したか。ログ / エラーレスポンスの step に使う。 */
export type RichMenuApplyStage =
  | "image_validation"
  | "image_fetch"
  | "create"
  | "image_upload"
  | "verify_new"
  | "set_default"
  | "verify_default"
  | "persist";

/** 補償動作（cleanup / rollback）の結果。primary error を上書きしないため戻り値で持ち回る。 */
export interface RichMenuCompensation {
  attempted: boolean;
  ok:        boolean;
  error?:    string;
}

/**
 * apply の失敗を、運用者に見せる文言と失敗段を持たせて表す。
 *
 * LINE API の二次エラー（例: 400 "must upload richmenu image before applying it to user"）を
 * そのまま出すと原因が分からないため、一次原因（例: 画像が 1MB 超）を operatorMessage に載せる。
 */
export class RichMenuApplyError extends Error {
  readonly stage:      RichMenuApplyStage;
  /** CMS の運用者に見せる一次原因。 */
  readonly operatorMessage: string;
  /** 新メニューの後始末結果（best-effort）。 */
  readonly cleanup?:   RichMenuCompensation;
  /** 旧 default へ戻す補償の結果。 */
  readonly rollback?:  RichMenuCompensation;
  readonly newLineRichMenuId?: string | null;

  constructor(args: {
    stage: RichMenuApplyStage;
    operatorMessage: string;
    message?: string;
    cause?: unknown;
    cleanup?: RichMenuCompensation;
    rollback?: RichMenuCompensation;
    newLineRichMenuId?: string | null;
  }) {
    super(args.message ?? args.operatorMessage, { cause: args.cause });
    this.name = "RichMenuApplyError";
    this.stage = args.stage;
    this.operatorMessage = args.operatorMessage;
    this.cleanup = args.cleanup;
    this.rollback = args.rollback;
    this.newLineRichMenuId = args.newLineRichMenuId ?? null;
  }
}

export interface ApplyRichMenuResult {
  lineRichMenuId: string;
  imageUploaded:  boolean;
  /** 置き換え前の LINE メニュー ID（DB が持っていた値）。 */
  oldLineRichMenuId?: string | null;
  /** 旧メニューを最後の cleanup で削除できたか。 */
  oldMenuDeleted?:    boolean;
  /** DB が指す旧 ID が LINE 上に存在しなかった（過去の失敗による stale 参照）。 */
  oldMenuMissingOnLine?: boolean;
  /** 致命的でない警告（旧メニュー削除失敗など）。apply 自体は成功。 */
  warnings?: string[];
}

/** 外部 I/O の差し替え口。既定は本物の LINE API 実装。failure-path をテストするために使う。 */
export interface RichMenuApplyDeps {
  createRichMenu:      (token: string, config: RichMenuConfig) => Promise<string>;
  uploadRichMenuImage: (token: string, richMenuId: string, buf: Buffer, mimeType: string) => Promise<void>;
  setDefaultRichMenu:  (token: string, richMenuId: string) => Promise<void>;
  getDefaultRichMenuId:(token: string) => Promise<string | null>;
  richMenuExists:      (token: string, richMenuId: string) => Promise<boolean>;
  richMenuImageExists: (token: string, richMenuId: string) => Promise<boolean>;
  deleteRichMenu:      (token: string, richMenuId: string) => Promise<void>;
  /** 画像 URL から本体を取る。size / mime の検証はこの外で行う。 */
  fetchImage:          (url: string) => Promise<{ buffer: Buffer; mimeType: string }>;
}

const defaultDeps: RichMenuApplyDeps = {
  createRichMenu,
  uploadRichMenuImage: (t, id, buf, mime) => uploadRichMenuImage(t, id, buf, mime),
  setDefaultRichMenu,
  getDefaultRichMenuId,
  richMenuExists: async (t, id) => (await getRichMenuStatus(t, id)) !== null,
  richMenuImageExists,
  deleteRichMenu,
  fetchImage: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`画像の取得に失敗しました (HTTP ${res.status})`);
    const ct = res.headers.get("content-type") ?? "";
    const mimeType = ct.includes("png") ? "image/png" : ct.includes("jpeg") || ct.includes("jpg") ? "image/jpeg" : ct;
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType };
  },
};

/** best-effort の後始末。失敗しても throw せず結果を返す（primary error を隠さない）。 */
async function compensate(
  label: string,
  prefix: string,
  fn: () => Promise<void>,
): Promise<RichMenuCompensation> {
  try {
    await fn();
    console.log(`${prefix} ${label} ok`);
    return { attempted: true, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // secondary error。primary error を上書きしないよう戻り値に載せるだけ。
    console.warn(`${prefix} ${label} 失敗（secondary）: ${error}`);
    return { attempted: true, ok: false, error };
  }
}

/**
 * RichMenuConfig（DB または Sheets から構築済み）を LINE に登録・適用する共通関数。
 *
 * ## 順序（2026-08-19 の本番障害を受けて変更）
 *
 * 旧実装は **最初に旧メニューを削除**し、**画像アップロード失敗を console.warn で無視**して
 * default 化へ進んでいた。その結果、画像が 1MB 超（3.09MB）だったケースで
 *
 *   旧 delete → 新 create → 画像 413（warn のみ）→ setDefault 400 → route が 500
 *   → DB 更新に到達せず
 *
 * となり、**LINE default = なし / DB = 既に削除済みの ID** という状態が固定された。
 * 利用者にリッチメニューが表示されなくなった。
 *
 * 現在の順序:
 *
 *   1. 旧メニューが LINE に存在するか確認（stale 参照なら以後 delete を試みない）
 *      + 現在の LINE default を保持（rollback 用）
 *   2. 画像を取得して **サイズ / MIME を送信前に検証**（1MB 超はここで確定的に失敗させる）
 *   3. 新メニュー create
 *   4. 画像 upload —— **失敗は致命的**。ここで中断し、新メニューを cleanup する
 *   5. 新メニューの read-back（存在 + 画像あり）
 *   6. setDefault
 *   7. default の read-back（setDefault の 200 だけを根拠にしない）
 *   8. persist（DB 更新。呼び出し側が渡した場合のみ。ここで失敗したら旧 default へ rollback）
 *   9. 旧メニュー delete —— **置き換え成功を確認したあとの cleanup**
 *
 * 外部 API と DB を ACID にはできないので、狙いは
 * 「安全な順序 + 補償動作 + read-back 検証」であって transaction ではない。
 *
 * **新メニューが完全に利用可能になるまで、利用中の旧メニューは絶対に削除しない。**
 *
 * @param params.persist DB 更新。setDefault + read-back の成功後に呼ばれる。
 *                       失敗したら旧 default へ戻し、新メニューを cleanup してから throw する。
 */
export async function applyRichMenuConfig(params: {
  token:              string;
  config:             RichMenuConfig;
  imageUrl?:          string | null;
  oldLineRichMenuId?: string | null;
  setDefault?:        boolean;
  logPrefix?:         string;
  persist?:           (lineRichMenuId: string) => Promise<void>;
  deps?:              Partial<RichMenuApplyDeps>;
}): Promise<ApplyRichMenuResult> {
  const prefix = params.logPrefix ?? "[applyRichMenuConfig]";
  const setDefault = params.setDefault !== false; // デフォルト true
  const d: RichMenuApplyDeps = { ...defaultDeps, ...params.deps };
  const warnings: string[] = [];
  const oldId = params.oldLineRichMenuId ?? null;

  const log = (stage: RichMenuApplyStage | "start" | "done", fields: Record<string, unknown>) => {
    // structured / grep 可能な 1 行ログ。token 等の秘匿情報は絶対に含めない。
    console.log(`${prefix} stage=${stage} ${Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ")}`);
  };

  // ── 1. 旧メニューの実在確認 + 現 default の把握（reconciliation / rollback 準備） ──
  //     DB が指す ID が LINE から消えていることがある（過去の apply 途中失敗）。
  //     その場合に delete を試みても意味がないので、事前に分けておく。
  let oldMenuMissingOnLine = false;
  if (oldId) {
    try {
      const exists = await d.richMenuExists(params.token, oldId);
      oldMenuMissingOnLine = !exists;
    } catch (e) {
      // 確認できないときは「存在するかもしれない」に倒す（消しに行かない側が安全）。
      warnings.push(`旧メニューの存在確認に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let previousDefaultId: string | null = null;
  if (setDefault) {
    try {
      previousDefaultId = await d.getDefaultRichMenuId(params.token);
    } catch (e) {
      warnings.push(`現在の default 取得に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log("start", { oldRichMenuId: oldId ?? "none", oldMenuMissingOnLine, previousDefaultId: previousDefaultId ?? "none",
                 setDefault, areas: params.config.areas.length,
                 size: `${params.config.size.width}x${params.config.size.height}` });

  // ── 2. 画像を取得して送信前に検証（1MB 超 / 非対応 MIME はここで確定的に失敗） ──
  let image: { buffer: Buffer; mimeType: string } | null = null;
  if (params.imageUrl) {
    try {
      image = await d.fetchImage(params.imageUrl);
    } catch (e) {
      log("image_fetch", { result: "error" });
      throw new RichMenuApplyError({
        stage: "image_fetch",
        operatorMessage: "リッチメニュー画像を取得できませんでした。画像を再アップロードしてください。",
        cause: e,
      });
    }
    log("image_validation", { bytes: image.buffer.byteLength, mimeType: image.mimeType,
                              limitBytes: RICH_MENU_IMAGE_MAX_BYTES });
    if (image.buffer.byteLength > RICH_MENU_IMAGE_MAX_BYTES) {
      const mb = formatBytesAsMb(image.buffer.byteLength);
      throw new RichMenuApplyError({
        stage: "image_validation",
        operatorMessage:
          `リッチメニュー画像は${RICH_MENU_IMAGE_MAX_LABEL}以下にしてください（現在 ${mb}MB）。` +
          `LINE公式アカウントのリッチメニュー画像は${RICH_MENU_IMAGE_MAX_LABEL}が上限です。`,
      });
    }
    if (!RICH_MENU_IMAGE_MIME_TYPES.includes(image.mimeType as RichMenuImageMimeType)) {
      throw new RichMenuApplyError({
        stage: "image_validation",
        operatorMessage: `リッチメニュー画像は PNG または JPEG にしてください（現在 ${image.mimeType || "不明"}）。`,
      });
    }
  }

  // ── 3. 新メニュー create（失敗 → 旧 default / DB はそのまま） ──
  let lineRichMenuId: string;
  try {
    lineRichMenuId = await d.createRichMenu(params.token, params.config);
  } catch (e) {
    log("create", { result: "error" });
    throw new RichMenuApplyError({
      stage: "create",
      operatorMessage: "リッチメニューの作成に失敗しました。時間をおいて再度お試しください。",
      cause: e,
    });
  }
  log("create", { result: "ok", newRichMenuId: lineRichMenuId });

  /** 新メニューを片付けてから throw する（旧 default は触らない）。 */
  const failAfterCreate = async (stage: RichMenuApplyStage, operatorMessage: string, cause?: unknown): Promise<never> => {
    const cleanup = await compensate("新メニュー cleanup", prefix,
      () => d.deleteRichMenu(params.token, lineRichMenuId));
    log(stage, { result: "error", newRichMenuId: lineRichMenuId, cleanup: cleanup.ok ? "ok" : "failed" });
    throw new RichMenuApplyError({ stage, operatorMessage, cause, cleanup, newLineRichMenuId: lineRichMenuId });
  };

  // ── 4. 画像 upload（失敗は致命的。ここから setDefault へ進ませない） ──
  let imageUploaded = false;
  if (image) {
    try {
      await d.uploadRichMenuImage(params.token, lineRichMenuId, image.buffer, image.mimeType);
      imageUploaded = true;
    } catch (e) {
      await failAfterCreate("image_upload",
        "リッチメニュー画像のアップロードに失敗しました。画像サイズ（1MB以下）と形式（PNG / JPEG）を確認してください。", e);
    }
    log("image_upload", { result: "ok", bytes: image.buffer.byteLength });
  } else {
    log("image_upload", { result: "skipped", reason: "no_image" });
  }

  // ── 5. 新メニューの read-back（存在 + 画像あり）。画像なしのメニューは default 化できない ──
  try {
    const exists = await d.richMenuExists(params.token, lineRichMenuId);
    if (!exists) {
      await failAfterCreate("verify_new", "作成したリッチメニューが LINE 上で確認できませんでした。再度お試しください。");
    }
    if (image) {
      const hasImage = await d.richMenuImageExists(params.token, lineRichMenuId);
      if (!hasImage) {
        await failAfterCreate("verify_new",
          "リッチメニュー画像が LINE 上で確認できませんでした。画像サイズ（1MB以下）と形式（PNG / JPEG）を確認してください。");
      }
    }
  } catch (e) {
    if (e instanceof RichMenuApplyError) throw e;
    await failAfterCreate("verify_new", "リッチメニューの確認に失敗しました。時間をおいて再度お試しください。", e);
  }
  log("verify_new", { result: "ok", newRichMenuId: lineRichMenuId, imageUploaded });

  // ── 6-7. default 適用 + read-back ──
  if (setDefault) {
    try {
      await d.setDefaultRichMenu(params.token, lineRichMenuId);
    } catch (e) {
      await failAfterCreate("set_default",
        "リッチメニューの適用（デフォルト設定）に失敗しました。旧メニューはそのまま維持されています。", e);
    }
    log("set_default", { result: "ok", newRichMenuId: lineRichMenuId });

    // setDefault の 200 だけを成功根拠にしない。
    let appliedId: string | null = null;
    try {
      appliedId = await d.getDefaultRichMenuId(params.token);
    } catch (e) {
      warnings.push(`default の read-back に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (appliedId !== null && appliedId !== lineRichMenuId) {
      // 反映されていない。旧 default へ戻して新メニューを片付ける。
      const rollback = await restoreDefault(d, params.token, previousDefaultId, prefix);
      const cleanup = await compensate("新メニュー cleanup", prefix,
        () => d.deleteRichMenu(params.token, lineRichMenuId));
      log("verify_default", { result: "mismatch", expected: lineRichMenuId, actual: appliedId ?? "none",
                              rollback: rollback.ok ? "ok" : "failed", cleanup: cleanup.ok ? "ok" : "failed" });
      throw new RichMenuApplyError({
        stage: "verify_default",
        operatorMessage: "リッチメニューの適用が LINE 側で確認できませんでした。旧メニューを維持しています。",
        message: `default mismatch: expected=${lineRichMenuId} actual=${appliedId ?? "none"}`,
        rollback, cleanup, newLineRichMenuId: lineRichMenuId,
      });
    }
    log("verify_default", { result: "ok", defaultRichMenuId: appliedId ?? "unverified" });
  }

  // ── 8. DB 更新（呼び出し側が persist を渡した場合のみ） ──
  //     ここで失敗すると「LINE default = 新 / DB = 旧」になるため、旧 default へ戻す。
  if (params.persist) {
    try {
      await params.persist(lineRichMenuId);
    } catch (e) {
      const rollback = setDefault
        ? await restoreDefault(d, params.token, previousDefaultId, prefix)
        : { attempted: false, ok: false };
      const cleanup = await compensate("新メニュー cleanup", prefix,
        () => d.deleteRichMenu(params.token, lineRichMenuId));
      log("persist", { result: "error", newRichMenuId: lineRichMenuId,
                       rollback: rollback.attempted ? (rollback.ok ? "ok" : "failed") : "skipped",
                       cleanup: cleanup.ok ? "ok" : "failed" });
      throw new RichMenuApplyError({
        stage: "persist",
        operatorMessage: rollback.attempted && !rollback.ok
          ? "リッチメニューの保存に失敗し、旧メニューへの復帰も失敗しました。運営に連絡してください。"
          : "リッチメニューの保存に失敗しました。旧メニューを維持しています。",
        cause: e, rollback, cleanup, newLineRichMenuId: lineRichMenuId,
      });
    }
    log("persist", { result: "ok", newRichMenuId: lineRichMenuId });
  }

  // ── 9. 旧メニュー delete（置き換え成功を確認したあとの cleanup） ──
  //     ここでの失敗はユーザー影響なし。apply 自体は成功として返す。
  let oldMenuDeleted = false;
  if (oldId && oldId !== lineRichMenuId) {
    if (oldMenuMissingOnLine) {
      log("done", { oldMenuDelete: "skipped", reason: "not_on_line", oldRichMenuId: oldId });
    } else {
      const del = await compensate(`旧メニュー削除 ${oldId}`, prefix,
        () => d.deleteRichMenu(params.token, oldId));
      oldMenuDeleted = del.ok;
      if (!del.ok) warnings.push(`旧リッチメニューの削除に失敗しました（表示への影響はありません）: ${del.error}`);
    }
  }

  log("done", { result: "ok", newRichMenuId: lineRichMenuId, oldRichMenuId: oldId ?? "none",
                oldMenuDeleted, imageUploaded, warnings: warnings.length });

  return { lineRichMenuId, imageUploaded, oldLineRichMenuId: oldId, oldMenuDeleted,
           oldMenuMissingOnLine, warnings: warnings.length ? warnings : undefined };
}

/** 旧 default へ戻す補償動作。旧 ID が無ければ何もしない（default を解除はしない）。 */
async function restoreDefault(
  d: RichMenuApplyDeps,
  token: string,
  previousDefaultId: string | null,
  prefix: string,
): Promise<RichMenuCompensation> {
  if (!previousDefaultId) {
    // 元から default が無かった場合は「戻す先」が無い。解除もしない（余計な変更をしない）。
    console.warn(`${prefix} rollback スキップ: 旧 default が無い`);
    return { attempted: false, ok: false };
  }
  return compensate(`旧 default へ復帰 ${previousDefaultId}`, prefix, async () => {
    const exists = await d.richMenuExists(token, previousDefaultId);
    if (!exists) throw new Error(`旧 default が LINE 上に存在しない: ${previousDefaultId}`);
    await d.setDefaultRichMenu(token, previousDefaultId);
  });
}
