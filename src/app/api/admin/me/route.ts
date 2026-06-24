// src/app/api/admin/me/route.ts
// GET /api/admin/me — 現在ユーザーのプラットフォームロール（is_platform_owner）を返す。
//
// per-user / auth 応答なので **絶対にキャッシュさせない**（PR-AUTH1）。
// 既定の dynamic 応答は `Cache-Control: public, max-age=0, must-revalidate` かつ Cookie で vary しないため、
// 共有キャッシュ/ブラウザ/bfcache に platform-owner 判定が乗り、client 側の「スタジオ管理」表示が stale に
// なる不具合があった（OA作成は server で都度判定＝正しいのに、ボタンだけ古い値になる乖離）。
// → force-dynamic + revalidate=0 + Cache-Control: private, no-store + Vary: Cookie, Authorization で防ぐ。
//   判定ソース（PLATFORM_ADMIN_USER_IDS）と権限ロジックは不変。変わるのは「常に現在ユーザーの fresh 値を返す」点のみ。

import { withAuth } from "@/lib/auth";
import { ok, serverError } from "@/lib/api-response";
import { isPlatformOwner } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** auth / per-user 応答にキャッシュ不可ヘッダを付与する。 */
function noStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.headers.set("Vary", "Cookie, Authorization");
  return res;
}

export const GET = withAuth(async (_req, _ctx, user) => {
  try {
    return noStore(ok({ is_platform_owner: isPlatformOwner(user.id) }));
  } catch (err) {
    return noStore(serverError(err));
  }
});
