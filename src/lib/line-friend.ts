// src/lib/line-friend.ts
//
// LINE 公式アカウント（OA）の「友だち状態」判定と、友だち追加 URL の安全な生成。
//
// Phase 2（チケットリンク LIFF 連携）で、本人確認（verifyLiffAccessToken＝LIFF ユーザートークン検証）
// とは**分離**して、対象 OA が当該ユーザーを友だちに持つか（かつ未ブロックか）を確認するために使う。
//
// 判定は Messaging API `GET /v2/bot/profile/{userId}`（対象 OA の channelAccessToken）で行う:
//   - 200        → 友だち登録済みかつ未ブロック（= 連携続行可）
//   - 404        → 未追加 または ブロック（区別不可）。FRIEND_REQUIRED
//   - 401 / 403  → OA の Messaging API 設定不備（ユーザーの未追加として扱わない）。OA_LINE_CONFIG_ERROR
//   - 429 / 5xx / 通信失敗 → 一時失敗。再試行可能・恒久状態は変更しない。NETWORK_ERROR
//
// 既存の webhook `getLineUserProfile` / phase-move `fetchDisplayName` は非200を一律 null/"" に潰して
// 404 を区別しないため友だち判定には流用できない。ここでは status を保存して区別する。

const LINE_BOT_PROFILE_URL = "https://api.line.me/v2/bot/profile";

/** 友だち状態の判定結果（HTTP status を意味づけした discriminated union）。 */
export type OaFriendStatus =
  /** 200: 友だち登録済みかつ未ブロック。 */
  | { kind: "friend" }
  /** 404: 未追加 または ブロック（Messaging API では区別不可）。 */
  | { kind: "not_friend" }
  /** 401 / 403: 対象 OA の channelAccessToken 不正・権限不足。設定不備であり「未追加」ではない。 */
  | { kind: "config_error"; status: number }
  /** 429 / 5xx / 通信失敗: 一時的な失敗。再試行可能。 */
  | { kind: "unavailable"; status: number | null };

/**
 * 対象 OA が `lineUserId` を友だちに持つか（未ブロックか）を Messaging API で判定する。
 * fetchImpl を注入できるようにしてテスト可能にする（既定は global fetch）。
 *
 * 引数の channelAccessToken は **対象 OA（トークンから解決した oaId）のもの**を渡すこと。
 * 別 OA のトークンで判定してはならない（テナント越境）。
 */
export async function getOaFriendStatus(
  lineUserId: string,
  channelAccessToken: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<OaFriendStatus> {
  const uid = (lineUserId ?? "").trim();
  const token = (channelAccessToken ?? "").trim();
  // 入力不備は「判定不能（一時失敗扱い）」にして、未追加や設定不備と誤認しない。
  if (!uid || !token) return { kind: "unavailable", status: null };

  const doFetch = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${LINE_BOT_PROFILE_URL}/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache:   "no-store",
    });
  } catch {
    return { kind: "unavailable", status: null };
  }

  if (res.status === 200) return { kind: "friend" };
  if (res.status === 404) return { kind: "not_friend" };
  if (res.status === 401 || res.status === 403) return { kind: "config_error", status: res.status };
  // 429 / 5xx / その他は一時失敗として再試行可能に倒す（恒久状態は変更しない）。
  return { kind: "unavailable", status: res.status };
}

/** 制御文字（改行含む C0 + DEL）を含むか。正規表現に制御文字リテラルを埋め込まない実装。 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * OA の Basic ID（`Oa.lineOaId`・例 "613zlngs"）から友だち追加 URL を生成する。
 * 出力ドメインは **`line.me` に固定**し、任意 URL を受け付けない（Open Redirect を発生させない）。
 *
 * 正規化・防御:
 *   - 前後空白除去 / 先頭 `@`（重複含む）除去 / 空文字は null
 *   - 改行・制御文字を含む値は拒否（null）
 *   - Basic ID の許容文字 `[A-Za-z0-9._-]` 以外を含む値は拒否（null）＝ URL 断片注入不可
 *   - 未設定・不正はすべて null（別 OA URL や固定 URL へフォールバックしない）
 */
export function buildLineAddFriendUrl(lineOaId: string | null | undefined): string | null {
  if (lineOaId == null) return null;
  const trimmed = lineOaId.trim();
  if (trimmed === "") return null;
  if (hasControlChar(trimmed)) return null;
  // 先頭 @（重複可）を除去してから正規化。
  const id = trimmed.replace(/^@+/, "");
  if (id === "") return null;
  // Basic ID の想定 charset のみ許可（それ以外は不正）。
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  return `https://line.me/R/ti/p/@${id}`;
}
