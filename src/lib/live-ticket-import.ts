// src/lib/live-ticket-import.ts
//
// ESCAPE.ID 予約データ取込（CSV/Excel）の純ロジック。API route / UI / テストで共用。
//   - ESCAPE.ID は Open API を提供しないため、Excel/CSV を Whale Studio へ取込む。
//   - 1 行 = 1 チケット = 1 LiveTeam（Participant は取込では作らない。LIFF 連携時に生成）。
//   - 主キーは ticketId（システムチケットID）。互換のため reservationNumber = ticketId を保存する。
//   - メールアドレス・平文 LIFF URL・平文 token は DB に保存しない（出力 CSV/レスポンスのみ）。
//
// このモジュール自体は DB / mint に触れない純関数のみ（テスト容易・client/server 両用）。

import { normalizeGroupType } from "@/lib/live-team";
import { csvCell } from "@/lib/location-log";

/** ESCAPE.ID の取込対象フィールド（内部キー）。email/purchased_at は一時利用＝DB 非保存。 */
export type EscapeIdField =
  | "show_date" | "show_time" | "purchased_at"
  | "ticket_type" | "user_name" | "email" | "ticket_id";

export const ESCAPEID_FIELDS: EscapeIdField[] = [
  "show_date", "show_time", "purchased_at", "ticket_type", "user_name", "email", "ticket_id",
];

/** 列名の表記揺れ自動検出（大文字小文字・全半角の揺れは header 正規化後に照合）。 */
const HEADER_PATTERNS: Array<[RegExp, EscapeIdField]> = [
  [/(公演日|開催日|開演日|イベント日|日付)/, "show_date"],
  [/(公演時間|公演時刻|開演時間|開始時間|開始時刻|時間)/, "show_time"],
  [/(購入日時|購入日|注文日時|申込日時|決済日時)/, "purchased_at"],
  [/(チケット種別|券種|種別|チケットタイプ|種類)/, "ticket_type"],
  [/(ユーザー名|お名前|氏名|購入者名|購入者|名前)/, "user_name"],
  [/(メールアドレス|メール|e-?mail|アドレス)/i, "email"],
  [/(システム側チケットid|システムチケットid|チケットid|整理番号|チケット番号|券番号|チケットコード)/i, "ticket_id"],
];

/** ヘッダー文字列を照合用に正規化（trim + 全角英数→半角 + 小文字化 + 空白除去）。 */
function normalizeHeader(h: string): string {
  return String(h)
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * 検出済みヘッダー配列から `EscapeIdField → 元ヘッダー文字列` のマッピングを作る。
 * override（ユーザー手動指定: ヘッダー→field）があれば最優先。1 field に複数ヘッダーが当たれば最初を採用。
 */
export function mapEscapeIdHeaders(
  headers: string[],
  override?: Partial<Record<string, EscapeIdField>>,
): Partial<Record<EscapeIdField, string>> {
  const map: Partial<Record<EscapeIdField, string>> = {};
  // 1) override（ヘッダー→field）を先に適用。
  if (override) {
    for (const h of headers) {
      const f = override[h];
      if (f && !map[f]) map[f] = h;
    }
  }
  // 2) 自動検出でパターン一致を埋める（未割当 field のみ）。
  for (const h of headers) {
    const nh = normalizeHeader(h);
    for (const [re, field] of HEADER_PATTERNS) {
      if (!map[field] && re.test(nh)) map[field] = h;
    }
  }
  return map;
}

/** 公演日 + 公演時間 を JST として Date へ（参考情報。解釈不能は null）。 */
export function parseShowDateTime(dateStr: string, timeStr: string): Date | null {
  const ds = (dateStr ?? "").trim();
  if (!ds) return null;
  const m = ds.match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2].padStart(2, "0");
  const dd = m[3].padStart(2, "0");
  let hh = "00", mi = "00";
  const ts = (timeStr ?? "").trim();
  if (ts) {
    const tm = ts.match(/^(\d{1,2})[:：時](\d{1,2})/);
    if (tm) { hh = tm[1].padStart(2, "0"); mi = tm[2].padStart(2, "0"); }
  }
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** 表示用「HH:MM」（time 文字列から抽出。無ければ空）。 */
function shortTime(timeStr: string): string {
  const tm = (timeStr ?? "").trim().match(/^(\d{1,2})[:：時](\d{1,2})/);
  if (!tm) return "";
  return `${tm[1].padStart(2, "0")}:${tm[2].padStart(2, "0")}`;
}
/** 表示用「YYYY-MM-DD」（date 文字列から抽出。無ければ元値 trim）。 */
function shortDate(dateStr: string): string {
  const m = (dateStr ?? "").trim().match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (!m) return (dateStr ?? "").trim();
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/**
 * team 名を生成（個人名を含めない・運用で識別しやすい形）。
 * 例: "2026-08-17 14:00 Ticket 1234"。日時が無ければ "Ticket 1234"。
 */
export function buildTicketTeamName(dateStr: string, timeStr: string, ticketId: string): string {
  const d = shortDate(dateStr);
  const t = shortTime(timeStr);
  const head = [d, t].filter(Boolean).join(" ");
  const id = String(ticketId ?? "").trim();
  return head ? `${head} Ticket ${id}` : `Ticket ${id}`;
}

/**
 * チケット種別 → groupType（two/four/null）。
 *   1) 既存 normalizeGroupType（"2名"/"two"/2 等の完全一致）を優先。
 *   2) 外れたら種別文字列中の最初の数字を見て 2→two / 4→four（例 "2名券"/"4名様"/"2枚"）。
 *   3) それ以外（"ペア"/"1名"/"3名"/不明）は null（定員なし扱い・警告）。
 * ※ 正式な種別→定員の対応表は運用確定事項（暫定実装）。
 */
export function resolveTicketGroupType(ticketType: string | null | undefined): "two" | "four" | null {
  const exact = normalizeGroupType(ticketType);
  if (exact) return exact;
  const m = String(ticketType ?? "").match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (n === 2) return "two";
    if (n === 4) return "four";
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 1 行分の取込入力（ヘッダーマッピング適用後の生値）。 */
export interface TicketRowInput {
  show_date: string; show_time: string; purchased_at: string;
  ticket_type: string; user_name: string; email: string; ticket_id: string;
}

/** 正規化・検証済みの 1 チケット仕様。errors があれば valid=false（適用時 skip）。 */
export interface TicketRowSpec {
  rowIndex: number;
  ticketId: string;              // trim 済み・必須
  reservationNumber: string;     // = ticketId
  groupType: "two" | "four" | null;
  purchaserName: string | null;
  reservedAt: Date | null;
  teamName: string;
  // 参考/出力用（reservedAt/purchaserName/groupType 以外は DB 非保存）。
  showDate: string; showTime: string; purchasedAt: string; ticketType: string; email: string;
  errors: string[];
  warnings: string[];
  valid: boolean;
}

/** マッピング済み row からフィールドを取り出す。 */
export function extractTicketRow(
  row: Record<string, string>,
  mapping: Partial<Record<EscapeIdField, string>>,
): TicketRowInput {
  const g = (f: EscapeIdField): string => {
    const h = mapping[f];
    return h != null ? String(row[h] ?? "").trim() : "";
  };
  return {
    show_date: g("show_date"), show_time: g("show_time"), purchased_at: g("purchased_at"),
    ticket_type: g("ticket_type"), user_name: g("user_name"), email: g("email"), ticket_id: g("ticket_id"),
  };
}

/** 生入力 → 検証済み TicketRowSpec。 */
export function normalizeTicketRow(input: TicketRowInput, rowIndex: number): TicketRowSpec {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ticketId = input.ticket_id.trim();
  if (!ticketId) errors.push("チケットIDが空です");
  if (ticketId.length > 200) errors.push("チケットIDが長すぎます");

  const groupType = resolveTicketGroupType(input.ticket_type);
  if (!groupType && input.ticket_type.trim() !== "") {
    warnings.push(`チケット種別「${input.ticket_type}」を two/four に判定できません（定員なし扱い）`);
  }

  const email = input.email.trim();
  if (email && !EMAIL_RE.test(email)) warnings.push("メールアドレスの形式が不正です");

  const reservedAt = parseShowDateTime(input.show_date, input.show_time);
  if (input.show_date.trim() && !reservedAt) warnings.push("公演日時を解釈できません（参考情報のため取込は継続）");

  return {
    rowIndex,
    ticketId,
    reservationNumber: ticketId,
    groupType,
    purchaserName: input.user_name.trim() || null,
    reservedAt,
    teamName: buildTicketTeamName(input.show_date, input.show_time, ticketId),
    showDate: input.show_date, showTime: input.show_time, purchasedAt: input.purchased_at,
    ticketType: input.ticket_type, email,
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

/** 適用結果 1 行（apply レスポンス / 出力 CSV 共用）。url/expiresAt は発行時のみ非 null。 */
export interface TicketResultRow {
  showDate: string; showTime: string; purchasedAt: string; ticketType: string;
  userName: string; email: string; ticketId: string;
  url: string | null;
  expiresAt: string | null;
  result: "issued" | "skipped" | "failed";
  error: string;
}

const RESULT_LABEL: Record<TicketResultRow["result"], string> = {
  issued: "発行", skipped: "発行済み(skip)", failed: "失敗",
};

/** 出力 CSV 列（順序固定・§11）。 */
export const TICKET_CSV_HEADERS = [
  "公演日", "公演時間", "購入日時", "チケット種別", "ユーザー名", "メールアドレス",
  "TicketID", "LIFF URL", "有効期限", "結果", "エラー内容",
] as const;

/**
 * 結果行 → CSV 文字列（UTF-8 BOM 付き・CRLF・CSV インジェクション対策済み csvCell 使用）。
 * 失敗行も含める（§12）。LIFF URL はこの出力時のみ取得可能。
 */
export function buildTicketResultCsv(rows: TicketResultRow[]): string {
  const header = TICKET_CSV_HEADERS.map(csvCell).join(",");
  const lines = rows.map((r) => [
    r.showDate, r.showTime, r.purchasedAt, r.ticketType, r.userName, r.email,
    r.ticketId, r.url ?? "", r.expiresAt ?? "", RESULT_LABEL[r.result], r.error,
  ].map(csvCell).join(","));
  return "\uFEFF" + [header, ...lines].join("\r\n") + "\r\n";
}
