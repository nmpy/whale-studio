// src/lib/location-log.ts
// 統合ロケーションログ（GPS / QR / Beacon）の正規化ヘルパー + 表示メタ + CSV ユーティリティ。
//
// GPS/QR の成功は LocationVisit、非成功は CheckinAttempt、Beacon は BeaconEventLog という
// 3 ソースを UI 用に 1 つの行形へ正規化する。DB は変更しない（read 専用集約）。
// ※ 本ファイルは client からも import される（prisma を import しないこと。fetch は location-log-query.ts）。

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
  line_user_id: string | null;     // フル（UI で末尾表示 / CSV も末尾のみ）
  message_id: string | null;
  error_message: string | null;
  is_test: boolean;
  /** PII / 巨大 JSON を含まない短い要約（CSV の rawSummary 列にも使う）。 */
  detail: string | null;
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

// ── userId 末尾表示（一覧 / CSV 共通。フル ID は出さない） ──
export function tailUserId(uid: string | null | undefined): string {
  if (!uid) return "";
  return uid.length > 6 ? `…${uid.slice(-6)}` : uid;
}

// ── source（ソーステーブル）→ CSV 表記 ──
export const LOG_SOURCE_CSV: Record<UnifiedLogRow["source"], string> = {
  visit:   "location_visit",
  attempt: "checkin_attempt",
  beacon:  "beacon_event_log",
};

// ── JST 整形（CSV / ファイル名） ──
/** ISO → "YYYY-MM-DD HH:mm:ss"（JST）。 */
export function formatJstCsv(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // en-CA + Asia/Tokyo で "YYYY-MM-DD, HH:mm:ss" を得て整形
  const s = d.toLocaleString("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return s.replace(",", "");
}

/** JST の YYYYMMDD（ファイル名用）。now は注入可。 */
export function jstFileStamp(now: Date): string {
  const s = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  return s.replace(/-/g, "");
}

// ── CSV セル安全化（quote + CSV injection 対策） ──
/** セル値を CSV 安全化する。
 *  - = + - @ で始まる（先頭タブ/CR含む）値は数式インジェクション防止のため先頭に ' を付与
 *  - " , 改行 を含む場合は "" エスケープ + ダブルクオート囲み */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // 制御文字（タブ/改行を除く）を空白へ。破壊・巨大化を防ぐ
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // 数式インジェクション無効化
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 統合ログ CSV の列定義（順序固定）。 */
export const LOG_CSV_COLUMNS = [
  "createdAtJst", "type", "status", "workName", "pointName",
  "locationId", "beaconTriggerId", "lineUserIdTail", "messageName",
  "errorMessage", "isTest", "source", "rawSummary",
] as const;

/** UnifiedLogRow[] を CSV 文字列（UTF-8 BOM 付き）へ。messageNameById で message 名を解決。 */
export function buildLogsCsv(rows: UnifiedLogRow[], opts?: { messageNameById?: Record<string, string> }): string {
  const header = LOG_CSV_COLUMNS.join(",");
  const lines = rows.map((r) => {
    const messageName = r.message_id ? (opts?.messageNameById?.[r.message_id] ?? r.message_id) : "";
    return [
      formatJstCsv(r.ts),
      r.type,
      r.outcome,
      r.work_title ?? "",
      r.point_name ?? "",
      r.location_id ?? "",
      r.beacon_trigger_id ?? "",
      tailUserId(r.line_user_id),
      messageName,
      r.error_message ?? "",
      r.is_test ? "true" : "false",
      LOG_SOURCE_CSV[r.source],
      r.detail ?? "",
    ].map(csvCell).join(",");
  });
  return "﻿" + [header, ...lines].join("\r\n");
}
