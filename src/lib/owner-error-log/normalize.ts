// src/lib/owner-error-log/normalize.ts
// 3 種の失敗ログ → 共通 View Model への正規化（純関数・prisma 非依存＝テスト可能）。
//   - 原因名は「既知の状態値からのマップ」のみ（生 JSON / stack trace / event code は出さない）。
//   - 補足(detail)は秘匿情報を除去し上限文字数へ切り詰め。
//   - プレイヤーは匿名タグ（生 LINE userId 非露出）。

import { playerTag } from "@/lib/activity-feed";
import type {
  OwnerErrorLogItem, OwnerErrorLogSource, OwnerErrorLogType,
} from "./types";

export const TYPE_BY_SOURCE: Record<OwnerErrorLogSource, OwnerErrorLogType> = {
  beacon_event: "beacon",
  checkin_attempt: "checkin",
  scheduled_line_message: "message",
};

export const SOURCE_BY_TYPE: Record<OwnerErrorLogType, OwnerErrorLogSource> = {
  beacon: "beacon_event",
  checkin: "checkin_attempt",
  message: "scheduled_line_message",
};

/** 画面表示用の種別ラベル（色だけに頼らずテキストで区別）。 */
export const TYPE_LABEL: Record<OwnerErrorLogType, string> = {
  beacon: "Beacon",
  checkin: "現地",
  message: "メッセージ",
};

/** 種別バッジのトーン（activity-feed の ACTIVITY_TONE_CLASS と同じキー空間）。 */
export const TYPE_TONE: Record<OwnerErrorLogType, "amber" | "purple" | "blue"> = {
  beacon: "amber",
  checkin: "purple",
  message: "blue",
};

/** CheckinAttempt.status（success 以外）→ ユーザー向け原因名。 */
const CHECKIN_CAUSE: Record<string, string> = {
  out_of_range: "チェックイン範囲外",
  permission_denied: "位置情報の許可なし",
  gps_unavailable: "GPS を利用できません",
  location_not_supported: "未対応のチェックイン地点",
  location_config_incomplete: "地点設定が未完了",
  invalid_request: "不正なチェックイン要求",
};

/** 原因コード → ユーザー向け原因名（既知値のみ・未知は種別の総称へフォールバック）。 */
export function causeTitle(source: OwnerErrorLogSource, causeCode: string | null, isRedelivery: boolean): string {
  switch (source) {
    case "beacon_event":
      return isRedelivery ? "Beacon 再送に失敗" : "Beacon アクションに失敗";
    case "checkin_attempt":
      return (causeCode && CHECKIN_CAUSE[causeCode]) || "現地チェックインに失敗";
    case "scheduled_line_message":
      return "メッセージ送信に失敗";
  }
}

const DETAIL_MAX = 80;

/**
 * 補足テキストの安全化。既知の短い文字列カラム（error_message / failure_reason / last_error）専用。
 * 秘匿情報・識別子・URL・トークンを除去し、制御文字を潰し、上限で切り詰める。任意 JSON は扱わない。
 */
export function sanitizeDetail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw);
  // 制御文字（改行/タブ/その他）→ 空白。stack trace の複数行を 1 行化。
  s = s.replace(/[\x00-\x1F\x7F]+/g, " ");
  // 秘匿情報の除去（多層防御。値そのものを出さない）。
  s = s
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***")
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "(token)") // JWT 風
    .replace(/(secret|token|password|passwd|authorization|cookie|api[\s_-]?key|access[\s_-]?token|signature)\s*[:=]\s*\S+/gi, "$1: ***")
    .replace(/https?:\/\/\S+/gi, "(url)")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "(db-url)")
    .replace(/U[0-9a-fA-F]{32}/g, "(user)") // 生 LINE userId
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, "(id)") // 内部 UUID
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX) + "…" : s;
}

/** 匿名プレイヤータグ（生 userId 非露出）。無ければ null（UI 側で "—"）。 */
export function playerOf(lineUserId: string | null | undefined, oaId: string): string | null {
  return lineUserId ? playerTag(lineUserId, oaId) : null;
}

/** 正規化前の生行（raw SQL / 内部整形の共通形）。 */
export interface RawErrorLogRow {
  source: OwnerErrorLogSource;
  sourceId: string;
  occurredAt: Date | string;
  oaId: string;
  lineUserId: string | null;
  causeCode: string | null;
  detail: string | null;
  isRedelivery: boolean;
  resolvedAt: Date | string | null;
}

/** 生行 → View Model（accountName は外部で解決した表示名）。 */
export function toErrorLogItem(row: RawErrorLogRow, accountName: string): OwnerErrorLogItem {
  const occurredAt = row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString();
  const resolvedAt = row.resolvedAt == null ? null : (row.resolvedAt instanceof Date ? row.resolvedAt.toISOString() : new Date(row.resolvedAt).toISOString());
  const type = TYPE_BY_SOURCE[row.source];
  return {
    source: row.source,
    sourceId: row.sourceId,
    occurredAt,
    oaId: row.oaId,
    accountName,
    type,
    title: causeTitle(row.source, row.causeCode, row.isRedelivery),
    detail: sanitizeDetail(row.detail),
    player: playerOf(row.lineUserId, row.oaId),
    isResolved: resolvedAt != null,
    resolvedAt,
  };
}
