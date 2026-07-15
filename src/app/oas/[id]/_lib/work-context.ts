// src/app/oas/[id]/_lib/work-context.ts
//
// 作品コンテキスト（共通サイドバー）の「表示判定」「workId 解決」「active カテゴリ算出」を
// 1 か所に集約した純関数群。route ごとに layout を増やさず、/oas/[id] 直下の client 境界
// （WorkShellBoundary）からこの判定を使うことで、作品コンテキスト付きページを追加しても
// サイドバー適用漏れが起きないようにする（候補A: 集約判定）。
//
// workId の正（優先順位）:
//   1) pathname の /works/[workId]（ただし作成ページ "new" 等は作品ではないので除外）
//   2) 上記が無ければ query の ?workId=
//   → pathname を優先する（URL 構造が示す作品を正とする）。pathname に無く query にだけある場合は query を使う。
//
// ここで解決する workId は「サイドバーのリンク生成」にしか使わない。作品情報や権限の確定には使わない
// （OA をまたぐ不正な workId をクライアント値だけで信頼しないため。権限・所属確認は各ページの
//  既存の認可済みデータ取得経路が引き続き担保する）。

/** /works/[workId] のうち workId として信頼しない静的セグメント（作成ページ等の兄弟ルート）。 */
const NON_WORK_ID_SEGMENTS = new Set(["new"]);

/**
 * pathname から作品 workId を取り出す（/oas/[id]/works/[workId]/... 形式）。
 * 作成ページ（/works/new）等の静的セグメントは workId として扱わない。無ければ null。
 */
export function workIdFromPathname(pathname: string): string | null {
  const m = pathname.match(/\/works\/([^/?#]+)/);
  const seg = m?.[1];
  if (!seg || NON_WORK_ID_SEGMENTS.has(seg)) return null;
  return seg;
}

/** 印刷専用ルート（workId があっても Shell を完全に除外する）。 */
export function isPrintRoute(pathname: string): boolean {
  return pathname.endsWith("/print") || pathname.includes("/locations/print");
}

export type WorkShellDecision = {
  /** 作品サイドバー（WorkManagementShell）を表示するか。 */
  show: boolean;
  /** 解決済み workId（show=false のとき null）。リンク生成専用。 */
  workId: string | null;
  /**
   * サイドバーのアクティブキー（機能カテゴリ）。
   *   - ロケーション系 → "locations"、ビーコン系 → "beacons"。
   *   - それ以外の作品配下（作品トップ/フェーズ/…）は null（呼び出し側が pathname ベースで判定）。
   */
  activeKey: string | null;
};

/**
 * 作品サイドバーの表示判定 + workId 解決 + active カテゴリ算出（純関数・テスト可能）。
 *   - pathname workId を優先し、無ければ query workId。どちらも無ければ非表示。
 *   - 印刷ルートは workId があっても非表示。
 *   - active カテゴリ: ビーコン系（/beacons を含む）→ "beacons"、ロケーション系（/locations を含む）→ "locations"。
 *     どちらも含まない作品配下ページは null（= pathname ベースで active 判定）。
 *     ※ /locations/beacons や /works/[id]/beacons は "beacons" を優先（先に判定）。
 */
export function resolveWorkShell(args: { pathname: string; queryWorkId: string | null }): WorkShellDecision {
  const { pathname, queryWorkId } = args;
  const workId = workIdFromPathname(pathname) ?? (queryWorkId || null);
  if (!workId || isPrintRoute(pathname)) return { show: false, workId: null, activeKey: null };

  let activeKey: string | null = null;
  if (pathname.includes("/beacons")) activeKey = "beacons";
  else if (pathname.includes("/locations")) activeKey = "locations";
  return { show: true, workId, activeKey };
}

/**
 * 既存 query を壊さずに ?workId= を維持するリンク helper（手書きの文字列結合をしない）。
 *   - workId が空（null/undefined/""）なら元 href をそのまま返す。
 *   - href が既に workId を持つ場合は上書きしない（呼び出し側が明示した値を優先）。
 *   - hash（#...）は考慮しない（本アプリのリンクは query のみ）。
 */
export function withWorkId(href: string, workId: string | null | undefined): string {
  if (!workId) return href;
  const [base, existingQs = ""] = href.split("?");
  const params = new URLSearchParams(existingQs);
  if (!params.has("workId")) params.set("workId", workId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
