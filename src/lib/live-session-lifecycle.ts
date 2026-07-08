// src/lib/live-session-lifecycle.ts
//
// Live 公演（LiveSession）の lifecycle 用の純ロジック / スキーマ（PR2a）。
//   status: draft(下書き) → active(進行中=当日運営開始) → ended(終了)。
//   active な公演にだけ以降の Runtime→Live 同期が束ねられる（同期本体は PR2b）。
// route と test の両方から参照できるよう lib 化（Next.js route は任意 export を推奨しないため）。

import { z } from "zod";

export const LIVE_SESSION_STATUSES = ["draft", "active", "ended"] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

export const LIVE_SESSION_STATUS_LABELS: Record<LiveSessionStatus, string> = {
  draft:  "下書き",
  active: "進行中",
  ended:  "終了",
};

/** PATCH /api/oas/:id/live/sessions/:sessionId の入力スキーマ。 */
export const patchLiveSessionSchema = z.object({
  name:      z.string().min(1).max(120).optional(),
  status:    z.enum(LIVE_SESSION_STATUSES).optional(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at:   z.string().datetime().optional().nullable(),
}).refine(
  (v) => v.name !== undefined || v.status !== undefined || v.starts_at !== undefined || v.ends_at !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

export function isLiveSessionStatus(v: unknown): v is LiveSessionStatus {
  return typeof v === "string" && (LIVE_SESSION_STATUSES as readonly string[]).includes(v);
}
