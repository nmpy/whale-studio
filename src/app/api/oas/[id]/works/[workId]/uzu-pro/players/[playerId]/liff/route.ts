// src/app/api/oas/[id]/works/[workId]/uzu-pro/players/[playerId]/liff/route.ts
// POST /api/oas/:id/works/:workId/uzu-pro/players/:playerId/liff — プレイヤー個別の LIFF リンク発行。
//
// 認可: authorizeUzuPro（platform owner / grant 保有 active メンバー）。権限なし/OA 不在は 404。
// テナント境界: player は当該 OA + 当該 work に属するもののみ操作可（他作品/他OAは 404）。
// 発行の正本は issueLiffForPlayer（$transaction 内で呼ぶ）。未発行のみ発行（reissue=false）。
// 平文 URL は「issued」時のレスポンスに一度だけ載る（DB には保存しない）。

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
  const auth = await authorizeUzuPro(req, params.id);
  if (!auth.ok) return auth.response;

  // テナント境界: 当該 OA + 当該 work のプレイヤーのみ（他作品/他 OA は存在を露出せず 404）。
  const player = await prisma.uzuProPlayer.findFirst({
    where:  { id: params.playerId, oaId: params.id, booking: { workId: params.workId } },
    select: { id: true, status: true, booking: { select: { liveSession: { select: { startsAt: true } } } } },
  });
  if (!player) return notFound("プレイヤー");

  // LIFF 未設定の OA では URL を生成できない（422）。
  const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { liffId: true } });
  const liffId = getLiffIdForUrlGeneration(oa);
  if (!liffId) return unprocessable("このアカウントの LIFF が未設定です", "LIFF_NOT_CONFIGURED");

  const now = new Date();
  const expiresAt = resolveTicketExpiresAt({ startsAt: player.booking?.liveSession?.startsAt ?? null, now });

  const result = await prisma.$transaction((tx) =>
    issueLiffForPlayer(tx, { oaId: params.id, playerId: params.playerId, liffId, expiresAt, now, reissue: false }),
  );

  switch (result.kind) {
    case "issued":
      await recordUzuProActivity(prisma, {
        oaId: params.id, workId: params.workId, actorUserId: auth.user.id,
        action: "liff_issue", targetType: "player", targetId: params.playerId,
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
