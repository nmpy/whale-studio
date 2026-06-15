// src/lib/beacon-utils.ts
// BeaconTrigger / BeaconEventLog の DB 行を API レスポンス（snake_case）形式に変換するヘルパー。

import type { BeaconTrigger, BeaconEventLog } from "@prisma/client";

export type BeaconTriggerResponse = {
  id:               string;
  oa_id:            string;
  work_id:          string | null;
  location_id:      string | null;
  name:             string;
  hwid:             string;
  enabled:          boolean;
  event_types:      string;
  cooldown_seconds: number;
  once_per_user:    boolean;
  max_triggers_per_user: number | null;
  valid_from:       string | null;
  valid_to:         string | null;
  note:             string | null;
  action_type:      string;
  action_payload:   Record<string, unknown> | null;
  created_at:       string;
  updated_at:       string;
  /** 直近の検知ログ */
  last_event_at:    string | null;
  last_action_status: string | null;
  /** 付帯情報（一覧表示用・任意）: 作品名。OA 共通トリガー（work_id=null）は null。 */
  work_title?:      string | null;
};

export function toBeaconTriggerResponse(
  t: BeaconTrigger,
  lastEvent: { createdAt: Date; actionStatus: string } | null,
  extra?: { workTitle?: string | null },
): BeaconTriggerResponse {
  return {
    id:               t.id,
    oa_id:            t.oaId,
    work_id:          t.workId,
    location_id:      t.locationId,
    name:             t.name,
    hwid:             t.hwid,
    enabled:          t.enabled,
    event_types:      t.eventTypes,
    cooldown_seconds: t.cooldownSeconds,
    once_per_user:    t.oncePerUser,
    max_triggers_per_user: t.maxTriggersPerUser,
    valid_from:       t.validFrom?.toISOString() ?? null,
    valid_to:         t.validTo?.toISOString() ?? null,
    note:             t.note,
    action_type:      t.actionType,
    action_payload:   (t.actionPayload as Record<string, unknown> | null) ?? null,
    created_at:       t.createdAt.toISOString(),
    updated_at:       t.updatedAt.toISOString(),
    last_event_at:    lastEvent?.createdAt.toISOString() ?? null,
    last_action_status: lastEvent?.actionStatus ?? null,
    ...(extra && "workTitle" in extra ? { work_title: extra.workTitle ?? null } : {}),
  };
}

// ────────────────────────────────────────────────
// BeaconEventLog → レスポンス
// ────────────────────────────────────────────────

export type BeaconEventLogResponse = {
  id:               string;
  oa_id:            string;
  work_id:          string | null;
  beacon_trigger_id: string | null;
  line_user_id:     string | null;
  hwid:             string;
  beacon_type:      string;
  device_message:   string | null;
  webhook_event_id: string;
  is_redelivery:    boolean;
  action_status:    string;
  error_message:    string | null;
  message_id:       string | null;
  is_test:          boolean;
  raw_event:        unknown;
  created_at:       string;
  /** 付帯（join）: トリガー名 / 作品名 */
  trigger_name:     string | null;
  work_title:       string | null;
};

export function toBeaconEventLogResponse(
  l: BeaconEventLog,
  extra?: { triggerName?: string | null; workTitle?: string | null },
): BeaconEventLogResponse {
  return {
    id:               l.id,
    oa_id:            l.oaId,
    work_id:          l.workId,
    beacon_trigger_id: l.beaconTriggerId,
    line_user_id:     l.lineUserId,
    hwid:             l.hwid,
    beacon_type:      l.beaconType,
    device_message:   l.deviceMessage,
    webhook_event_id: l.webhookEventId,
    is_redelivery:    l.isRedelivery,
    action_status:    l.actionStatus,
    error_message:    l.errorMessage,
    message_id:       l.messageId,
    is_test:          l.isTest,
    raw_event:        l.rawEvent ?? null,
    created_at:       l.createdAt.toISOString(),
    trigger_name:     extra?.triggerName ?? null,
    work_title:       extra?.workTitle ?? null,
  };
}

// ────────────────────────────────────────────────
// outcome（action_status）の表示ラベル + 区分
// ────────────────────────────────────────────────
//
// 既存の actionStatus 値（PR #237 から不変）に、本 PR で追加した skipped_* 値を加えたもの。
// ユーザー指定の outcome 語彙（skipped_no_trigger 等）との対応もここで吸収し、UI 表示はこのラベルを使う。
//   - unknown_beacon         ↔ skipped_no_trigger
//   - ignored(disabled)      ↔ skipped_disabled
//   - cooldown               ↔ skipped_cooldown
//   - service_stopped        ↔ skipped_service_stopped

export type BeaconOutcomeKind = "sent" | "matched" | "skipped" | "failed" | "unknown";

export const BEACON_OUTCOME_META: Record<string, { label: string; kind: BeaconOutcomeKind }> = {
  sent:                    { label: "送信",                   kind: "sent" },
  matched:                 { label: "マッチ（ログのみ）",     kind: "matched" },
  cooldown:                { label: "スキップ（クールダウン）", kind: "skipped" },
  skipped_once_per_user:   { label: "スキップ（1回限り済）",   kind: "skipped" },
  skipped_max_per_user:    { label: "スキップ（上限到達）",     kind: "skipped" },
  skipped_invalid_period:  { label: "スキップ（期間外）",       kind: "skipped" },
  unknown_beacon:          { label: "未登録ビーコン",          kind: "skipped" },
  service_stopped:         { label: "スキップ（OA停止中）",     kind: "skipped" },
  plan_blocked:            { label: "スキップ（プラン制限）",   kind: "skipped" },
  message_not_configured:  { label: "メッセージ未設定",        kind: "skipped" },
  ignored:                 { label: "スキップ",                kind: "skipped" },
  failed:                  { label: "失敗",                   kind: "failed" },
};

/** ログ画面のフィルタ用 outcome 候補（実際に actionStatus に保存されうる値）。 */
export const BEACON_OUTCOME_VALUES = Object.keys(BEACON_OUTCOME_META);

export function beaconOutcomeLabel(status: string): { label: string; kind: BeaconOutcomeKind } {
  return BEACON_OUTCOME_META[status] ?? { label: status, kind: "unknown" };
}
