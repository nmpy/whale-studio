// src/lib/owner-error-log/types.ts
// スタジオ全体エラーログ（Phase 2）の共通型。Client へは正規化済み View Model のみ渡す。

/** 対象ログの内部安定値（画面には出さない）。 */
export type OwnerErrorLogSource = "beacon_event" | "checkin_attempt" | "scheduled_line_message";

/** ユーザー向け種別（フィルタ値）。 */
export type OwnerErrorLogType = "beacon" | "checkin" | "message";

export type OwnerErrorLogStatusFilter = "all" | "unresolved" | "resolved";
export type OwnerErrorLogPeriod = "7d" | "30d" | "month" | "all";

export interface OwnerErrorLogFilters {
  status: OwnerErrorLogStatusFilter;
  /** null = すべてのアカウント。 */
  oaId: string | null;
  /** "all" = すべての種別。 */
  type: "all" | OwnerErrorLogType;
  period: OwnerErrorLogPeriod;
  /** 1 始まり。 */
  page: number;
}

/** 正規化済みエラーログ 1 件（一覧描画・CSV で共有）。生 DB モデルは含めない。 */
export interface OwnerErrorLogItem {
  source: OwnerErrorLogSource;
  sourceId: string;
  /** 発生時刻（ISO / UTC）。表示は JST。 */
  occurredAt: string;
  oaId: string;
  accountName: string;
  type: OwnerErrorLogType;
  /** ユーザー向けの原因名（安全・既知値からのマップ）。 */
  title: string;
  /** サニタイズ済みの補足（安全・上限文字数）。無ければ null。 */
  detail: string | null;
  /** 匿名プレイヤータグ（生 userId 非露出）。lineUserId 無しは null。 */
  player: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
}
