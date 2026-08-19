// src/lib/destination-utils.ts
// LineDestination の API レスポンス変換ユーティリティ
//
// resolved_url は「運用者がリッチメニュー等へ保存する URL」の正本になる。
// destinationType="liff" のときは **対象 OA の Oa.liffId** が必要で、
// env の共通 LIFF へフォールバックしてはいけない（誤 OA の URL が本番に焼き付く）。
// 呼び出し元の API route が Oa.liffId を解決して opts.liffId で渡すこと。
// 渡されなければ resolved_url は null（= 設定不足）になる。

import { resolveDestinationUrl } from "./destination-url-builder";

/** DB の LineDestination レコードを API レスポンス形式に変換する。
 *  @param opts.liffId       対象 OA の Oa.liffId（未指定なら liff 型の resolved_url は null）。
 *  @param opts.workPublicId 対象 Work の publicId（canonical `/w/{workPublicId}` を組むのに使う）。 */
export function toDestinationResponse(d: {
  id: string;
  workId: string;
  key: string;
  name: string;
  description: string | null;
  destinationType: string;
  liffTargetType: string | null;
  urlOrPath: string | null;
  queryParamsJson: unknown;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}, opts?: { liffId?: string | null; workPublicId?: string | null }) {
  return {
    id:                d.id,
    work_id:           d.workId,
    work_public_id:    opts?.workPublicId ?? null,
    key:               d.key,
    name:              d.name,
    description:       d.description,
    destination_type:  d.destinationType,
    liff_target_type:  d.liffTargetType,
    url_or_path:       d.urlOrPath,
    query_params_json: d.queryParamsJson as Record<string, string>,
    is_enabled:        d.isEnabled,
    resolved_url:      resolveDestinationUrl({
      destinationType: d.destinationType,
      liffTargetType:  d.liffTargetType,
      urlOrPath:       d.urlOrPath,
      queryParamsJson: d.queryParamsJson as Record<string, string>,
      workId:          d.workId,
      workPublicId:    opts?.workPublicId ?? null,
    }, { liffId: opts?.liffId ?? null }),
    created_at:        d.createdAt,
    updated_at:        d.updatedAt,
  };
}
