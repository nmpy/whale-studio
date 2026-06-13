// src/app/api/oas/[id]/locations/route.ts
// GET /api/oas/[id]/locations — OA 配下の Location を全作品横断で集約取得（読み取り専用）
//
// 統合「チェックインポイント」一覧（/oas/[id]/locations）用。
// 既存の作品スコープ API（GET /api/locations?work_id=）は後方互換でそのまま残す。
// Location.workId は必須のため OA 共通行は存在しない（各行は必ず作品に属する）。
// 書き込み・checkin 処理・LIFF は一切触らない（既存導線を壊さないための read 専用追加）。

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    // 既存 GET /api/locations と同じく viewer 以上（プラン gate はページ側 PlanRequiredCard が担う）。
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const locations = await prisma.location.findMany({
      where:   { work: { oaId } },
      include: {
        work:   { select: { id: true, title: true } },
        _count: { select: { visits: true } },
      },
      orderBy: [{ workId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return ok(
      locations.map((l) => ({
        id:                   l.id,
        work_id:              l.workId,
        work_title:           l.work?.title ?? null,
        name:                 l.name,
        description:          l.description,
        checkin_mode:         l.checkinMode,
        is_active:            l.isActive,
        latitude:             l.latitude,
        longitude:            l.longitude,
        radius_meters:        l.radiusMeters,
        cooldown_seconds:     l.cooldownSeconds,
        transition_id:        l.transitionId,
        qr_success_message_id: l.qrSuccessMessageId,
        stamp_enabled:        l.stampEnabled,
        visit_count:          l._count.visits,
        created_at:           l.createdAt.toISOString(),
        updated_at:           l.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    return serverError(err);
  }
});
