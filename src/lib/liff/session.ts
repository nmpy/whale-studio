// src/lib/liff/session.ts
//
// LIFF セッション確立のサーバー側検証ロジック。
//
// フロントから送られた userId / displayName は信用せず、LINE のアクセストークンを
// サーバーで検証して「本物の lineUserId」を取得する。
//
// 検証方式:
//   LIFF SDK の liff.getAccessToken() で得たユーザーアクセストークンを使い、
//   GET https://api.line.me/v2/profile (Authorization: Bearer <accessToken>) を叩く。
//   - 200 + userId が返れば、そのトークンは LINE が発行した有効なものと確認でき、
//     userId はサーバー検証済みの値として信用してよい。
//   - 401/400 等ならトークン無効 → 検証失敗。
//
// ※ idToken の検証 (POST https://api.line.me/oauth2/v2.1/verify) は LINE Login チャネル ID
//   (= aud) が必要だが、本プロジェクトは OA ごとの LINE Login チャネル ID を保持していないため、
//   accessToken 経路を正式サポートとする。idToken のみ送られた場合は accessToken を要求する
//   (= 未検証トークンを信用しない安全側)。

/** LINE プロフィール API のレスポンス（必要分のみ）。 */
interface LineProfileResponse {
  userId?:      string;
  displayName?: string;
  pictureUrl?:  string;
}

export type LiffSessionVerifyResult =
  | { ok: true;  lineUserId: string; displayName: string | null }
  /** reason はログ用（ユーザーには出さない）。 */
  | { ok: false; reason: "missing_access_token" | "token_invalid" | "no_user_id" | "request_failed" };

const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/profile";

/**
 * LIFF アクセストークンを LINE プロフィール API で検証し、サーバー検証済みの lineUserId を返す。
 * fetchImpl を注入できるようにしてテスト可能にする（既定は global fetch）。
 */
export async function verifyLiffAccessToken(
  accessToken: string | null | undefined,
  opts?: { fetchImpl?: typeof fetch },
): Promise<LiffSessionVerifyResult> {
  const token = (accessToken ?? "").trim();
  if (!token) return { ok: false, reason: "missing_access_token" };

  const doFetch = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(LINE_PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
      cache:   "no-store",
    });
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  if (!res.ok) {
    // 401 = トークン無効/期限切れ、その他 4xx/5xx も検証失敗として扱う。
    return { ok: false, reason: "token_invalid" };
  }

  let profile: LineProfileResponse;
  try {
    profile = (await res.json()) as LineProfileResponse;
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  const userId = (profile.userId ?? "").trim();
  if (!userId) return { ok: false, reason: "no_user_id" };

  return { ok: true, lineUserId: userId, displayName: profile.displayName?.trim() || null };
}

/** ユーザー向け文言（reason に依らず一貫した安全なメッセージ）。 */
export const LIFF_SESSION_USER_ERROR = "LINE連携に失敗しました。もう一度開き直してください。";
