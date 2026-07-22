// src/app/api/oas/[id]/works/[workId]/uzu-pro/players/[playerId]/liff/reissue/route.ts
// POST /api/oas/:id/works/:workId/uzu-pro/players/:playerId/liff/reissue — 失効して再発行。
//
// 個別発行との違い: reissue=true。既存の issued リンクを revoke してから新規発行する（旧 URL は失効）。
// 認可・テナント境界・LIFF 未設定・期限算出は個別発行と同じ。新 URL は「issued」時に一度だけ返る。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, conflict, unprocessable } from "@/lib/api-response";
import { authorizeUzuPro } from "@/lib/uzupro-auth";
import { issueLiffForPlayer } from "@/lib/uzupro/liff";
import { recordUzuProActivity } from "@/lib/uzupro/activity";
import { resolveTicketExpiresAt } from "@/lib/live-ticket-link";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; workId: string; playerId: string } },
) {
  const auth = await authorizeUzuPro(req, params.id, params.workId);
  if (!auth.ok) return auth.response;

  const player = await prisma.uzuProPlayer.findFirst({
    where:  { id: params.playerId, oaId: params.id, booking: { workId: params.workId } },
    select: { id: true, status: true, booking: { select: { liveSession: { select: { startsAt: true } } } } },
  });
  if (!player) return notFound("プレイヤー");

  const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { liffId: true } });
  const liffId = getLiffIdForUrlGeneration(oa);
  if (!liffId) return unprocessable("このアカウントの LIFF が未設定です", "LIFF_NOT_CONFIGURED");

  const now = new Date();
  const expiresAt = resolveTicketExpiresAt({ startsAt: player.booking?.liveSession?.startsAt ?? null, now });

  const result = await prisma.$transaction((tx) =>
    issueLiffForPlayer(tx, { oaId: params.id, playerId: params.playerId, liffId, expiresAt, now, reissue: true }),
  );

  switch (result.kind) {
    case "issued":
      await recordUzuProActivity(prisma, {
        oaId: params.id, workId: params.workId, actorUserId: auth.user.id,
        action: "liff_reissue", targetType: "player", targetId: params.playerId,
      });
      return ok({ status: "issued", url: result.url });
    case "already_issued":
      return ok({ status: "already_issued" });
    case "skipped_cancelled":
      return conflict("キャンセル済みのため発行できません");
    case "not_found":
      return notFound("プレイヤー");
  }
}
