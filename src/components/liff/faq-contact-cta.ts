// src/components/liff/faq-contact-cta.ts
//
// FAQ 下部「お問い合わせ」CTA を contact ページへリンク化するための純ロジック（JSX なし）。
//  - findPublishedContactPage: メニューの page 一覧から「公開中 & 有効」な contact ページを 1 件選ぶ
//  - buildContactPageHref: その contact ページへの実機遷移 URL を組み立てる
// null / undefined / 非配列でも安全。公開/有効でない contact には絶対にリンクしない。

/** メニュー API（/api/liff/works/[workId]/menu）の page 1 件分のうち、判定に使う最小フィールド。 */
export interface ContactCtaPage {
  id:              string;
  public_id?:      string | null;
  page_type:       string | null;
  is_enabled:      boolean;
  publish_status?: string;
}

/**
 * 同 work 内のページ一覧から、リンク対象の contact ページを 1 件返す。
 *  条件: page_type === "contact" && publish_status === "published" && is_enabled === true
 *  - メニュー一覧の並び順を尊重し、条件を満たす最初の 1 件を返す。
 *  - null / undefined / 非配列なら null（落ちない）。
 *  - メニュー API は非 preview で既に published & enabled のみを返すが、
 *    preview や別経路で draft/disabled が混じっても弾けるよう二重に判定する。
 */
export function findPublishedContactPage(
  pages: ContactCtaPage[] | null | undefined,
): ContactCtaPage | null {
  if (!Array.isArray(pages)) return null;
  return (
    pages.find(
      (p) =>
        p &&
        p.page_type === "contact" &&
        p.publish_status === "published" &&
        p.is_enabled === true,
    ) ?? null
  );
}

/**
 * contact ページへの実機遷移 URL を組み立てる（ホームの buildPageHref と同じ短縮 URL 規則）。
 *  - public_id があれば `/liff/w/{workPublicId}/p/{public_id}`。
 *  - public_id が無ければ null を返す（壊れた href を作らない → 静的 CTA にフォールバック）。
 */
export function buildContactPageHref(
  workPublicId: string | null | undefined,
  page: ContactCtaPage | null | undefined,
): string | null {
  if (!workPublicId || !page) return null;
  const pid = page.public_id?.trim();
  if (!pid) return null;
  return `/liff/w/${workPublicId}/p/${pid}`;
}

/** pages + workPublicId から、リンク化すべき contact href（無ければ null）を一括で解決する。 */
export function resolveFaqContactHref(
  pages: ContactCtaPage[] | null | undefined,
  workPublicId: string | null | undefined,
): string | null {
  return buildContactPageHref(workPublicId, findPublishedContactPage(pages));
}
