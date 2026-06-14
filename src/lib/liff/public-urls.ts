// src/lib/liff/public-urls.ts
//
// LIFF 公開ページ / ロケーション（チェックインポイント）の **絶対 URL** を組み立てる純粋関数。
// ボタンリンク等で「ID 選択 → 実 URL を payload.url に解決して保存」する用途で使う。
// 絶対 URL にするのは、保存値が Zod の z.string().url() を通る必要があるため。
//
// origin の決定: NEXT_PUBLIC_BASE_URL があれば優先、なければ window.location.origin
// （preview→preview / 本番→本番。SSR で window が無いときは空文字 = 解決不可）。

function resolveBase(): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** LIFF ページ公開 URL。短縮ルート `/liff/w/{workPublicId}/p/{pagePublicId}` を優先、
 *  publicId が揃わなければ UUID ルート `/liff/work/{workId}/pages/{pageId}`。解決不可なら空文字。 */
export function buildLiffPageUrl(args: {
  workId?: string | null;
  workPublicId?: string | null;
  pageId?: string | null;
  pagePublicId?: string | null;
}): string {
  const base = resolveBase();
  if (!base) return "";
  if (args.workPublicId && args.pagePublicId) {
    return `${base}/liff/w/${args.workPublicId}/p/${args.pagePublicId}`;
  }
  if (args.workId && args.pageId) {
    return `${base}/liff/work/${args.workId}/pages/${args.pageId}`;
  }
  return "";
}

/** ロケーション（チェックインポイント）公開 URL。canonical `/liff/c/{workPublicId}/{locationPublicId}`。
 *  両 publicId が揃わなければ空文字。 */
export function buildLocationCheckinUrl(args: {
  workPublicId?: string | null;
  locationPublicId?: string | null;
}): string {
  const base = resolveBase();
  if (!base || !args.workPublicId || !args.locationPublicId) return "";
  return `${base}/liff/c/${args.workPublicId}/${args.locationPublicId}`;
}
