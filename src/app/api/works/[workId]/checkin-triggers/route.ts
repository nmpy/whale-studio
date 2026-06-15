// src/app/api/works/[workId]/checkin-triggers/route.ts
// GET /api/works/:workId/checkin-triggers?line_user_id=xxx
//   指定ユーザーの「地点到着トリガー（CheckinWaitTrigger）」状況を返す参照系API。
//   pending（待機中）/ consumed（通過済み）/ expired / canceled を、地点名・起点/到着メッセージ・
//   到着後フェーズ名・armedAt/consumedAt/expiresAt とあわせて返す。UserProgress.currentPhaseId も同梱。
//
//   - 参照のみ（強制消化/再arm/キャンセル等の変更操作は持たない）。
//   - プラン制限: location は Pro Max / 委託 のみ（location-stats と同方針）。
//   - 個人情報配慮: line_user_id の実値はレスポンスに含めず先頭8桁プレフィックスのみ返す。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";

export const dynamic = "force-dynamic";

function msgLabel(m: { body: string | null; messageType: string } | undefined, max = 40): string | null {
  if (!m) return null;
  if (m.body && m.body.trim()) return m.body.trim().slice(0, max);
  return `[${m.messageType}]`;
}

export const GET = withAuth<{ workId: string }>(async (req, { params }, user) => {
  try {
    const workId = params.workId;
    const oaId = await getOaIdFromWorkId(workId);
    if (oaId) {
      const check = await requireRole(oaId, user.id, "viewer");
      if (!check.ok) return check.response;
      // プラン制限: location は Pro Max / 委託 のみ（location-stats と同方針）。
      const planGuard = await requirePlanFeature({ oaId, featureKey: FEATURE.location });
      if (!planGuard.ok) return planGuard.response;
    }

    const lineUserId = new URL(req.url).searchParams.get("line_user_id")?.trim();
    if (!lineUserId) return badRequest("line_user_id は必須です");

    // ── トリガー本体 + 進行状態 ──
    const [triggers, progress] = await Promise.all([
      prisma.checkinWaitTrigger.findMany({
        where:   { workId, lineUserId },
        orderBy: [{ armedAt: "desc" }],
      }),
      prisma.userProgress.findUnique({
        where:  { lineUserId_workId: { lineUserId, workId } },
        select: { currentPhaseId: true },
      }),
    ]);

    // ── 参照 ID 群を batch ロード ──
    const locationIds = [...new Set(triggers.map((t) => t.locationId).filter(Boolean))] as string[];
    const messageIds  = [...new Set(triggers.flatMap((t) => [t.sourceMessageId, t.nextMessageId]).filter(Boolean))] as string[];
    const phaseIds    = [...new Set([
      ...triggers.map((t) => t.nextPhaseId).filter(Boolean) as string[],
      ...(progress?.currentPhaseId ? [progress.currentPhaseId] : []),
    ])];

    const [locations, messages, phases, beacons] = await Promise.all([
      locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      messageIds.length  ? prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, body: true, messageType: true } }) : Promise.resolve([]),
      phaseIds.length    ? prisma.phase.findMany({ where: { id: { in: phaseIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      // beacon 紐づけ確認用: 対象地点に紐づく BeaconTrigger 数（beacon トリガーの切り分け補助）。
      locationIds.length ? prisma.beaconTrigger.groupBy({ by: ["locationId"], where: { locationId: { in: locationIds } }, _count: { _all: true } }) : Promise.resolve([]),
    ]);

    const locName  = new Map(locations.map((l) => [l.id, l.name]));
    const msgMap   = new Map(messages.map((m) => [m.id, m]));
    const phaseMap = new Map(phases.map((p) => [p.id, p.name]));
    const beaconCountByLoc = new Map<string, number>();
    for (const g of beacons as Array<{ locationId: string | null; _count: { _all: number } }>) {
      if (g.locationId) beaconCountByLoc.set(g.locationId, g._count._all);
    }

    const items = triggers.map((t) => ({
      id:                    t.id,
      status:                t.status,
      trigger_type:          t.triggerType,
      location_id:           t.locationId,
      location_name:         locName.get(t.locationId) ?? null,
      source_message_id:     t.sourceMessageId,
      source_message_label:  msgLabel(t.sourceMessageId ? msgMap.get(t.sourceMessageId) : undefined),
      next_message_id:       t.nextMessageId,
      next_message_label:    msgLabel(t.nextMessageId ? msgMap.get(t.nextMessageId) : undefined),
      next_phase_id:         t.nextPhaseId,
      next_phase_name:       t.nextPhaseId ? (phaseMap.get(t.nextPhaseId) ?? null) : null,
      armed_at:              t.armedAt,
      consumed_at:           t.consumedAt,
      expires_at:            t.expiresAt,
      // beacon の場合のみ意味を持つ（対象地点に紐づく BeaconTrigger 数）。
      linked_beacon_count:   beaconCountByLoc.get(t.locationId) ?? 0,
    }));

    return ok({
      line_user_id_prefix: lineUserId.slice(0, 8),
      current_phase: progress?.currentPhaseId
        ? { id: progress.currentPhaseId, name: phaseMap.get(progress.currentPhaseId) ?? null }
        : null,
      triggers: items,
    });
  } catch (err) {
    return serverError(err);
  }
});
