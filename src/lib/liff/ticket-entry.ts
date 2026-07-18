// src/lib/liff/ticket-entry.ts
// 専用 LIFF URL からチケットトークン（?t=）を復元する純関数。
//   - 通常の location.search（?t=...）と、LINE が付与する liff.state（サブパス/クエリを退避）両対応。
//   - URL は一切変更しない（読み取り専用）。liff.state / liff.referrer / lineAppVersion 等 liff.* も変更しない。
//   - 多重 URL エンコードに上限（最大 3 回デコード）を設け、無限デコード/過剰再帰を防ぐ。
//   - トークン形式（base64url 相当）に合致しなければ null（不正 URL / token なしは安全に null）。

/** base64url トークンの形状（randomBytes(32)→43 char 想定・多少の幅を許容）。 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

/** クエリ文字列（"?a=b&t=x" / "t=x" / "/ticket?t=x" 等）から t を取り出す。 */
function tokenFromQueryLike(s: string): string | null {
  const qIdx = s.indexOf("?");
  const query = qIdx >= 0 ? s.slice(qIdx + 1) : s;
  try {
    return new URLSearchParams(query).get("t");
  } catch {
    return null;
  }
}

/** liff.state（URL エンコードされたサブパス/クエリ）から t を取り出す（最大 3 回デコード）。 */
function tokenFromLiffState(state: string | null): string | null {
  if (!state) return null;
  let s = state;
  for (let i = 0; i < 3; i++) {
    const t = tokenFromQueryLike(s);
    if (t) return t;
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      break;
    }
    if (decoded === s) break; // これ以上デコードで変化しない
    s = decoded;
  }
  return tokenFromQueryLike(s);
}

/**
 * 現在の URL（href）からチケットトークンを復元する。優先: 直 query ?t= → liff.state。
 * href を変更しない。見つからない/不正なら null。
 */
export function resolveTicketEntryToken(href: string | null | undefined): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const direct = url.searchParams.get("t");
  const fromState = direct ? null : tokenFromLiffState(url.searchParams.get("liff.state"));
  const raw = (direct ?? fromState ?? "").trim();
  if (!raw) return null;
  return TOKEN_RE.test(raw) ? raw : null;
}
