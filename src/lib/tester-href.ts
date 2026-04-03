/**
 * テスターモード時に /oas/{*}/works/... 系の href を
 * /tester/{testerOaId}/works/... に変換する共通関数。
 *
 * 変換対象:
 *   /oas/{any}/works                          → /tester/{testerOaId}
 *   /oas/{any}/works/{workId}{/rest}{?query}  → /tester/{testerOaId}/works/{workId}{/rest}{?query}
 *
 * 変換対象外:
 *   /oas/{any}/account/...  その他 OA レベルページ
 *   外部 URL、ハッシュのみ  など
 */
export function toTesterHref(href: string, testerOaId: string | null): string {
  if (!testerOaId) return href;

  // /oas/{id}/works/{workId}{/rest}{?query}
  const workMatch = href.match(/^\/oas\/[^/]+\/works\/([^/?#]+)((?:\/[^?#]*)?)(\?[^#]*)?(#.*)?$/);
  if (workMatch) {
    const workId = workMatch[1];
    const rest   = workMatch[2] ?? "";
    const query  = workMatch[3] ?? "";
    const hash   = workMatch[4] ?? "";
    return `/tester/${testerOaId}/works/${workId}${rest}${query}${hash}`;
  }

  // /oas/{id}/works（末尾スラッシュなし）
  if (/^\/oas\/[^/]+\/works$/.test(href)) {
    return `/tester/${testerOaId}`;
  }

  return href;
}
