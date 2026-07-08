// src/lib/live-team.ts
//
// LiveTeam（現地公演の部屋/グループ）の予約・部屋情報の純ロジック / スキーマ（PR2b-0）。
//   group_type: "two"(2人) | "four"(4人)。TEXT で保持し将来値追加も列変更なし。
// route と test で共用（Next.js route は任意 export を推奨しないため lib 化）。

import { z } from "zod";

export const LIVE_TEAM_GROUP_TYPES = ["two", "four"] as const;
export type LiveTeamGroupType = (typeof LIVE_TEAM_GROUP_TYPES)[number];

export const LIVE_TEAM_GROUP_TYPE_LABELS: Record<LiveTeamGroupType, string> = {
  two:  "2人",
  four: "4人",
};

export function isLiveTeamGroupType(v: unknown): v is LiveTeamGroupType {
  return typeof v === "string" && (LIVE_TEAM_GROUP_TYPES as readonly string[]).includes(v);
}

/** group_type の表示ラベル（未設定/不正は "-"）。 */
export function liveTeamGroupTypeLabel(v: string | null | undefined): string {
  return isLiveTeamGroupType(v) ? LIVE_TEAM_GROUP_TYPE_LABELS[v] : "-";
}

// ── 予約/部屋情報の共通スキーマ片（create/patch で再利用） ──
// すべて任意。日時は ISO 文字列（route 側で Date へ変換）。
export const liveTeamReservationFields = {
  reserved_at:    z.string().datetime().optional().nullable(),
  purchaser_name: z.string().max(200).optional().nullable(),
  group_type:     z.enum(LIVE_TEAM_GROUP_TYPES).optional().nullable(),
  room_number:    z.string().max(60).optional().nullable(),
  ticket_id:      z.string().max(120).optional().nullable(),
} as const;

/** LiveTeam create の入力スキーマ（既存 name/reservation_number/memo + 予約/部屋情報）。 */
export const createLiveTeamSchema = z.object({
  name:               z.string().min(1, "name は必須です").max(120),
  reservation_number: z.string().max(120).optional().nullable(),
  memo:               z.string().max(2000).optional().nullable(),
  ...liveTeamReservationFields,
});

/** LiveTeam patch の入力スキーマ（全項目任意・最低1項目必須）。 */
export const patchLiveTeamSchema = z.object({
  name:               z.string().min(1).max(120).optional(),
  reservation_number: z.string().max(120).optional().nullable(),
  memo:               z.string().max(2000).optional().nullable(),
  ...liveTeamReservationFields,
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

// ── レスポンス整形（route 共通・snake_case） ──
export interface LiveTeamRowLike {
  id: string;
  oaId: string;
  liveSessionId: string;
  name: string;
  reservationNumber: string | null;
  memo: string | null;
  reservedAt: Date | null;
  purchaserName: string | null;
  groupType: string | null;
  roomNumber: string | null;
  ticketId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toLiveTeamResponse(t: LiveTeamRowLike) {
  return {
    id:                 t.id,
    oa_id:              t.oaId,
    live_session_id:    t.liveSessionId,
    name:               t.name,
    reservation_number: t.reservationNumber,
    memo:               t.memo,
    reserved_at:        t.reservedAt,
    purchaser_name:     t.purchaserName,
    group_type:         t.groupType,
    room_number:        t.roomNumber,
    ticket_id:          t.ticketId,
    created_at:         t.createdAt,
    updated_at:         t.updatedAt,
  };
}
