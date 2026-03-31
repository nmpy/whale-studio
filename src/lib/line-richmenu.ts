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

// ────────────────────────────────────────────────
// 公開 API 関数
// ────────────────────────────────────────────────

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
 * PNG バイナリをリッチメニューにアップロードする。
 * LINE 要件: PNG/JPEG, 最大 1 MB。
 */
export async function uploadRichMenuImage(
  channelAccessToken: string,
  richMenuId: string,
  pngBuffer: Buffer
): Promise<void> {
  const res = await lineRequest(
    "POST",
    `${LINE_API_DATA_BASE}/richmenu/${richMenuId}/content`,
    channelAccessToken,
    pngBuffer,
    "image/png"
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

export interface ApplyRichMenuResult {
  lineRichMenuId: string;
  imageUploaded:  boolean;
}

/**
 * RichMenuConfig（DB または Sheets から構築済み）を LINE に登録・適用する共通関数。
 *
 * 処理フロー:
 *   1. oldLineRichMenuId があれば旧メニューを LINE から削除（失敗は無視）
 *   2. LINE API にメニューを登録 → lineRichMenuId 取得
 *   3. imageUrl があれば画像を fetch してアップロード（失敗は非致命的）
 *   4. setDefault = true（デフォルト）であれば全ユーザーへ適用
 *
 * @param params.token              チャンネルアクセストークン
 * @param params.config             LINE RichMenuConfig
 * @param params.imageUrl           背景画像 URL（null/undefined = スキップ）
 * @param params.oldLineRichMenuId  既存 LINE メニュー ID（あれば削除）
 * @param params.setDefault         デフォルト設定するか（デフォルト: true）
 * @param params.logPrefix          ログ識別子（例: "[apply]" / "[sync]"）
 */
export async function applyRichMenuConfig(params: {
  token:              string;
  config:             RichMenuConfig;
  imageUrl?:          string | null;
  oldLineRichMenuId?: string | null;
  setDefault?:        boolean;
  logPrefix?:         string;
}): Promise<ApplyRichMenuResult> {
  const prefix = params.logPrefix ?? "[applyRichMenuConfig]";
  const setDefault = params.setDefault !== false; // デフォルト true

  // ── 1. 旧メニュー削除 ──
  if (params.oldLineRichMenuId) {
    console.log(`${prefix} 旧メニュー削除: ${params.oldLineRichMenuId}`);
    try {
      await deleteRichMenu(params.token, params.oldLineRichMenuId);
    } catch (e) {
      console.warn(`${prefix} 旧メニュー削除スキップ（既に削除済み？）:`, e);
    }
  }

  // ── 2. 新メニュー登録 ──
  console.log(`${prefix} LINE API: メニュー登録 size=${params.config.size.width}x${params.config.size.height} areas=${params.config.areas.length}`);
  const lineRichMenuId = await createRichMenu(params.token, params.config);
  console.log(`${prefix} LINE API: 登録成功 lineRichMenuId=${lineRichMenuId}`);

  // ── 3. 画像アップロード ──
  let imageUploaded = false;
  if (params.imageUrl) {
    console.log(`${prefix} 画像アップロード: ${params.imageUrl}`);
    try {
      const imgRes = await fetch(params.imageUrl);
      if (!imgRes.ok) {
        console.warn(`${prefix} 画像 fetch 失敗 HTTP ${imgRes.status}: ${params.imageUrl}`);
      } else {
        const buf      = Buffer.from(await imgRes.arrayBuffer());
        const ct       = imgRes.headers.get("content-type") ?? "image/jpeg";
        const mimeType = ct.includes("png") ? "image/png" : "image/jpeg";
        const uploadRes = await fetch(
          `${LINE_API_DATA_BASE}/richmenu/${lineRichMenuId}/content`,
          {
            method:  "POST",
            headers: {
              Authorization:  `Bearer ${params.token}`,
              "Content-Type": mimeType,
            },
            body: buf,
          }
        );
        if (!uploadRes.ok) {
          console.warn(
            `${prefix} 画像アップロード失敗 HTTP ${uploadRes.status}:`,
            await uploadRes.text()
          );
        } else {
          imageUploaded = true;
          console.log(`${prefix} 画像アップロード成功`);
        }
      }
    } catch (imgErr) {
      console.warn(`${prefix} 画像アップロード例外（非致命的）:`, imgErr);
    }
  } else {
    console.log(`${prefix} 画像なし（スキップ）`);
  }

  // ── 4. デフォルト設定 ──
  if (setDefault) {
    console.log(`${prefix} デフォルト設定: ${lineRichMenuId}`);
    await setDefaultRichMenu(params.token, lineRichMenuId);
    console.log(`${prefix} デフォルト設定完了`);
  }

  return { lineRichMenuId, imageUploaded };
}
