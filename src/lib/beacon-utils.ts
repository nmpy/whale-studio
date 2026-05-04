// src/lib/beacon-utils.ts
// BeaconTrigger の DB 行を API レスポンス（snake_case）形式に変換するヘルパー。

import type { BeaconTrigger } from "@prisma/client";

export type BeaconTriggerResponse = {
  id:               string;
  oa_id:            string;
  work_id:          string | null;
  name:             string;
  hwid:             string;
  enabled:          boolean;
  event_types:      string;
  cooldown_seconds: number;
  action_type:      string;
  action_payload:   Record<string, unknown> | null;
  created_at:       string;
  updated_at:       string;
  /** 直近の検知ログ */
  last_event_at:    string | null;
  last_action_status: string | null;
};

export function toBeaconTriggerResponse(
  t: BeaconTrigger,
  lastEvent: { createdAt: Date; actionStatus: string } | null,
): BeaconTriggerResponse {
  return {
    id:               t.id,
    oa_id:            t.oaId,
    work_id:          t.workId,
    name:             t.name,
    hwid:             t.hwid,
    enabled:          t.enabled,
    event_types:      t.eventTypes,
    cooldown_seconds: t.cooldownSeconds,
    action_type:      t.actionType,
    action_payload:   (t.actionPayload as Record<string, unknown> | null) ?? null,
    created_at:       t.createdAt.toISOString(),
    updated_at:       t.updatedAt.toISOString(),
    last_event_at:    lastEvent?.createdAt.toISOString() ?? null,
    last_action_status: lastEvent?.actionStatus ?? null,
  };
}
