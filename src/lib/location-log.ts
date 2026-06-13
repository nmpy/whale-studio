// src/lib/location-log.ts
// 統合ロケーションログ（GPS / QR / Beacon）の正規化ヘルパー + 表示メタ。
//
// GPS/QR の成功は LocationVisit、非成功は CheckinAttempt、Beacon は BeaconEventLog という
// 3 ソースを UI 用に 1 つの行形へ正規化する。DB は変更しない（read 専用集約）。

export type LocationLogKind = "success" | "failed" | "skipped" | "attempted" | "sent" | "matched" | "unknown";

export type LocationLogType = "GPS" | "QR" | "GPS+QR" | "Beacon";

/** 正規化済みの 1 行（API レスポンス & UI 共通）。 */
export type UnifiedLogRow = {
  /** ソース横断で一意（"visit:<id>" | "attempt:<id>" | "beacon:<id>"） */
  id: string;
  source: "visit" | "attempt" | "beacon";
  ts: string;               // ISO（UI で JST 表示）
  type: LocationLogType;
  outcome: string;          // 生 status（success / out_of_range / sent / skipped_* など）
  work_id: string | null;
  work_title: string | null;
  point_name: string | null;       // location 名 or beacon 名
  location_id: string | null;
  beacon_trigger_id: string | null;
  line_user_id: string | null;     // フル（UI で末尾表示）
  message_id: string | null;
  error_message: string | null;
  is_test: boolean;
  raw: unknown;
};

// ── GPS/QR（LocationVisit / CheckinAttempt）の outcome 表示メタ ──
export const CHECKIN_OUTCOME_META: Record<string, { label: string; kind: LocationLogKind }> = {
  success:                    { label: "成功",            kind: "success" },
  out_of_range:               { label: "範囲外",          kind: "failed" },
  permission_denied:          { label: "位置情報拒否",    kind: "failed" },
  gps_unavailable:            { label: "GPS利用不可",     kind: "failed" },
  location_not_supported:     { label: "未対応地点",      kind: "skipped" },
  location_config_incomplete: { label: "設定不備",        kind: "failed" },
  invalid_request:            { label: "不正リクエスト",  kind: "failed" },
  timeout:                    { label: "タイムアウト",    kind: "failed" },
  unknown_error:              { label: "エラー",          kind: "failed" },
};

export function checkinOutcomeLabel(status: string): { label: string; kind: LocationLogKind } {
  return CHECKIN_OUTCOME_META[status] ?? { label: status, kind: "unknown" };
}

/** checkinMethod → 表示種別 */
export function checkinTypeFromMethod(method: string): LocationLogType {
  if (method === "qr_and_gps") return "GPS+QR";
  if (method === "qr") return "QR";
  return "GPS"; // "gps" / 既定
}

/** 種別フィルタ（gps/qr）→ checkinMethod の対象集合。 */
export function methodsForTypeFilter(type: "gps" | "qr"): string[] {
  return type === "gps" ? ["gps", "qr_and_gps"] : ["qr", "qr_and_gps"];
}
