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

/** 作品ホーム（作品メニュー）を **LINE アプリで開く** 実機 LIFF URL。
 *  形式: `https://liff.line.me/{liffId}{subpath}`。
 *  LINE Developers の Endpoint URL = `{BASE}/liff` を前提に、liffId の後ろへ sub-path を付けると
 *  LIFF アプリが `{BASE}/liff{subpath}` を開く（既存「実機で確認」と同方式）。
 *  ホームの sub-path は `/w/{workPublicId}`（publicId 無しは旧 `/work/{workId}`）。
 *  ※ bare `https://liff.line.me/{liffId}` は Endpoint 既定（チェックイン入口等）に落ちるため使わない。
 *  liffId 不在なら空文字。 */
export function buildWorkHomeLiffUrl(args: {
  liffId?: string | null;
  workPublicId?: string | null;
  workId?: string | null;
}): string {
  const id = args.liffId?.trim();
  if (!id) return "";
  if (args.workPublicId) return `https://liff.line.me/${id}/w/${args.workPublicId}`;
  if (args.workId)       return `https://liff.line.me/${id}/work/${args.workId}`;
  return "";
}

/** 管理画面「実機で確認する」の LIFF ページ用 sub-path。
 *  Endpoint URL = `{BASE}/liff` を前提にするため `/liff` は含めない。
 *  publicId が揃えば短縮 `/w/{wp}/p/{pp}`、無ければ旧 `/work/{w}/pages/{p}`。 */
export function buildLiffPageSubPath(args: {
  workId: string;
  workPublicId?: string | null;
  pageId?: string | null;
  pagePublicId?: string | null;
}): string {
  const { workId, workPublicId, pageId, pagePublicId } = args;
  if (workPublicId && pagePublicId) return `/w/${workPublicId}/p/${pagePublicId}`;
  if (workPublicId)                 return `/w/${workPublicId}`;
  if (pageId)                       return `/work/${workId}/pages/${pageId}`;
  return `/work/${workId}`;
}

/** 個別 LIFF ページを **LINE アプリで開く** 実機 LIFF URL。
 *  形式: `https://liff.line.me/{liffId}{subpath}`。
 *
 *  liffId は **必ず対象 OA の Oa.liffId** を渡すこと。
 *  `process.env.NEXT_PUBLIC_LIFF_ID` への fallback は**しない**（この関数も呼び出し側も）。
 *  理由（本番障害・D.O.T）: NEXT_PUBLIC_LIFF_ID はテスト用ログインチャネルの LIFF を指しており、
 *  そこから生成した URL をリッチメニューに保存すると、プレイヤーが**別 OA の同意画面**を踏み、
 *  そのチャネルにリンクされた別公式アカウントを友だち追加してしまう。
 *
 *  liffId 不在なら空文字（誤った ID で URL を作らない）。 */
export function buildLiffPageDeviceUrl(args: {
  liffId?: string | null;
  workId: string;
  workPublicId?: string | null;
  pageId?: string | null;
  pagePublicId?: string | null;
}): string {
  const id = args.liffId?.trim();
  if (!id || !args.workId) return "";
  return `https://liff.line.me/${id}${buildLiffPageSubPath(args)}`;
}
