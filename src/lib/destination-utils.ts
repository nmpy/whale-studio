// src/lib/destination-utils.ts
// LineDestination の API レスポンス変換ユーティリティ

import { resolveDestinationUrl } from "./destination-url-builder";

/** DB の LineDestination レコードを API レスポンス形式に変換する */
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
}) {
  return {
    id:                d.id,
    work_id:           d.workId,
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
    }),
    created_at:        d.createdAt,
    updated_at:        d.updatedAt,
  };
}
