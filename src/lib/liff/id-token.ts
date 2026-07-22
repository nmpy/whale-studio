// src/lib/liff/id-token.ts
// LINE ID トークン検証（LIFF プレイヤー連携用）。
//   POST https://api.line.me/oauth2/v2.1/verify に id_token + client_id(=LINE Login チャネルID) を送り、
//   署名・exp・aud を LINE 側で検証させる。成功時 sub(=LINE User ID) を返す。
//
// セキュリティ:
//   - クライアント申告の lineUserId は使わない。sub はサーバーが LINE から取得した値のみ。
//   - client_id(aud) は「想定している LINE Login チャネルID」= LIFF ID の数値プレフィックス
//     （LIFF ID = "{loginChannelId}-{liffAppId}"）から導出する。aud 不一致は拒否。
//   - iss は "https://access.line.me" のみ許可。
//   - id_token 生値・完全な LINE User ID はログへ出さない（呼び出し側で担保）。
//   - 5xx/429 は一時障害（再試行可）、4xx はトークン無効（永続）として区別する。

export type LiffIdTokenResult =
  | { ok: true; lineUserId: string }
  | {
      ok: false;
      reason:
        | "missing_id_token"
        | "missing_channel_id"
        | "token_invalid"
        | "audience_mismatch"
        | "no_sub"
        | "request_failed"
        | "temporarily_unavailable";
    };

const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";
const LINE_EXPECTED_ISS = "https://access.line.me";

/** LIFF ID("{loginChannelId}-{liffAppId}") から LINE Login チャネルID(= ID token の aud) を取り出す。 */
export function channelIdFromLiffId(liffId: string | null | undefined): string | null {
  const s = (liffId ?? "").trim();
  const m = /^(\d{5,})-/.exec(s);
  return m ? m[1] : null;
}

interface LineVerifyPayload {
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
}

/**
 * ID トークンを LINE の verify エンドポイントで検証し、サーバー検証済みの lineUserId(sub) を返す。
 * fetchImpl を注入可能（テスト用）。
 */
export async function verifyLiffIdToken(
  idToken: string | null | undefined,
  expectedChannelId: string | null | undefined,
  opts?: { fetchImpl?: typeof fetch },
): Promise<LiffIdTokenResult> {
  const token = (idToken ?? "").trim();
  if (!token) return { ok: false, reason: "missing_id_token" };
  const channelId = (expectedChannelId ?? "").trim();
  if (!channelId) return { ok: false, reason: "missing_channel_id" };

  const doFetch = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(LINE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // client_id を渡すことで LINE 側が aud==client_id を検証する（audience チェック）。
      body: new URLSearchParams({ id_token: token, client_id: channelId }).toString(),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  // 5xx / 429 = LINE の一時障害・レート制限 → 再試行可能として区別（ユーザーのアカウント不正扱いにしない）。
  if (res.status >= 500 || res.status === 429) return { ok: false, reason: "temporarily_unavailable" };
  // 4xx（署名不正 / exp 切れ / aud 不一致 等）= トークン無効。
  if (!res.ok) return { ok: false, reason: "token_invalid" };

  let payload: LineVerifyPayload;
  try {
    payload = (await res.json()) as LineVerifyPayload;
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  // 多層防御: iss / aud をサーバー側でも再確認（LINE 側検証に加えて）。
  if (payload.iss !== LINE_EXPECTED_ISS) return { ok: false, reason: "token_invalid" };
  if (payload.aud !== channelId) return { ok: false, reason: "audience_mismatch" };
  const sub = (payload.sub ?? "").trim();
  if (!sub) return { ok: false, reason: "no_sub" };

  return { ok: true, lineUserId: sub };
}
