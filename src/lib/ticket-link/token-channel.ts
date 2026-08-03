// src/lib/ticket-link/token-channel.ts
//
// チケット連携用の **strict** なアクセストークン検証（発行先チャネルの束縛）。
//
// 背景（再監査結果）:
//   既存の verifyLiffAccessToken は `GET /v2/profile` を叩いて userId を得るだけで、
//   「そのトークンがどの LINE Login チャネルで発行されたか」を検証していない。
//   したがって **別の LINE Login チャネルで発行された有効なトークンでも通ってしまう**。
//   getOaFriendStatus は「ユーザーが対象 OA の友だちか」を見るだけなので、
//   トークンの発行先チャネルまでは保証しない。
//
// 対策:
//   LINE の `GET https://api.line.me/oauth2/v2.1/verify?access_token=...` は
//   発行先チャネル ID を `client_id` として返す。
//   LIFF ID は `{LINE Login チャネルID}-{サフィックス}` という形式なので、
//   対象 OA の liffId から期待チャネル ID を導出し、client_id と一致することを確認する。
//
// 既存機能への影響を避けるため、共通関数 verifyLiffAccessToken は**変更しない**。
// チケット連携だけがこの strict ラッパーを使う。

const LINE_TOKEN_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

export type ChannelBindResult =
  /** 発行先チャネルが期待値と一致した。 */
  | { kind: "ok"; clientId: string }
  /** 別チャネルで発行されたトークン（流用）。 */
  | { kind: "channel_mismatch" }
  /** トークンが無効・期限切れ。 */
  | { kind: "token_invalid" }
  /** 期待チャネル ID を決められない（liffId 未設定など）。fail closed で扱う。 */
  | { kind: "expected_channel_unknown" }
  /** 一時的な通信失敗。 */
  | { kind: "unavailable" };

/**
 * LIFF ID から LINE Login チャネル ID を取り出す。
 * LIFF ID は `1234567890-abcdefgh` 形式で、ハイフン前の数値がチャネル ID。
 * 形式に合わない場合は null（＝束縛不能）。
 */
export function loginChannelIdFromLiffId(liffId: string | null | undefined): string | null {
  const v = (liffId ?? "").trim();
  if (v.length === 0) return null;
  const m = /^(\d{5,20})-[0-9A-Za-z]+$/.exec(v);
  return m ? m[1] : null;
}

/**
 * 対象 OA の LIFF が属する LINE Login チャネル ID を解決する。
 * Oa.liffId → env NEXT_PUBLIC_LIFF_ID の順（既存の LIFF ID 解決順に合わせる）。
 */
export function expectedLoginChannelId(oaLiffId: string | null | undefined): string | null {
  return loginChannelIdFromLiffId(oaLiffId) ?? loginChannelIdFromLiffId(process.env.NEXT_PUBLIC_LIFF_ID);
}

interface VerifyResponse {
  client_id?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * アクセストークンの発行先チャネルが、対象 OA の LIFF チャネルと一致するか検証する。
 * 一致しない / 判定できない場合は **fail closed**（呼び出し側で拒否する）。
 */
export async function verifyTokenIssuedForOaChannel(
  accessToken: string | null | undefined,
  oaLiffId: string | null | undefined,
  opts?: { fetchImpl?: typeof fetch },
): Promise<ChannelBindResult> {
  const token = (accessToken ?? "").trim();
  if (!token) return { kind: "token_invalid" };

  const expected = expectedLoginChannelId(oaLiffId);
  // 期待値が決められないなら「一致した」とは言えない。安全側に倒す。
  if (!expected) return { kind: "expected_channel_unknown" };

  const doFetch = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    // access_token を query に載せる仕様のため、URL はログへ出さないこと。
    res = await doFetch(`${LINE_TOKEN_VERIFY_URL}?access_token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable" };
  }

  // 400 = 無効なトークン。401/403 も無効扱い。
  if (res.status === 400 || res.status === 401 || res.status === 403) return { kind: "token_invalid" };
  if (!res.ok) return { kind: "unavailable" };

  let body: VerifyResponse;
  try {
    body = (await res.json()) as VerifyResponse;
  } catch {
    return { kind: "unavailable" };
  }

  const clientId = (body.client_id ?? "").trim();
  if (clientId.length === 0) return { kind: "unavailable" };
  // 期限切れ（負値/0）は無効として扱う。
  if (typeof body.expires_in === "number" && body.expires_in <= 0) return { kind: "token_invalid" };

  return clientId === expected ? { kind: "ok", clientId } : { kind: "channel_mismatch" };
}
