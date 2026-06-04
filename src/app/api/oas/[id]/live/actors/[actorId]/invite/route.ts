// src/app/api/oas/[id]/live/actors/[actorId]/invite/route.ts
// POST   /api/oas/:id/live/actors/:actorId/invite — 招待 URL を発行 (= 既存 active 招待を revoke + 新規発行)
// DELETE /api/oas/:id/live/actors/:actorId/invite — 現状の active 招待を無効化
//
// 認可: live admin 集合 (= authorizeLive)
//
// セキュリティ:
//   - 平文 token は DB に保存しない (= tokenHash のみ)
//   - POST 応答 1 回だけ平文 token / URL を返す。コピー後は復元不可。
//   - 同 actor で active な invite が複数残らないよう、発行時に既存 active を revoke する。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { created, ok, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import {
  generateInviteToken,
  hashInviteToken,
  defaultInviteExpiresAt,
  inviteState,
} from "@/lib/live-actor-invite";

export const dynamic = "force-dynamic";

function inviteAcceptUrl(req: NextRequest, _oaId: string, token: string): string {
  const url = new URL(req.url);
  // /oas/[id]/live/... layout は canAccessLive で未受諾ユーザーを 404 にするため、
  // 受諾 UI は OA scope の外 (= /live/invite/actor) に配置。
  // request の origin から組み立てる (= Preview / local 互換)。
  return `${url.origin}/live/invite/actor?token=${encodeURIComponent(token)}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; actorId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const actor = await prisma.liveActor.findFirst({
      where:  { id: params.actorId, oaId: params.id },
      select: { id: true, userId: true },
    });
    if (!actor) return notFound("Actor が見つかりません");

    const now = new Date();
    // 既存 active な invite を revoke (= 同 actor 1 active を維持)
    await prisma.liveActorInvite.updateMany({
      where: {
        actorId:    params.actorId,
        usedAt:     null,
        revokedAt:  null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      data: { revokedAt: now },
    });

    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = defaultInviteExpiresAt(now);

    const invite = await prisma.liveActorInvite.create({
      data: {
        oaId:            params.id,
        actorId:         params.actorId,
        tokenHash,
        expiresAt,
        createdByUserId: auth.user.id,
      },
    });

    return created({
      id:             invite.id,
      oa_id:          invite.oaId,
      actor_id:       invite.actorId,
      // 平文 token / URL は POST 応答 1 回だけ返す。
      invite_url:     inviteAcceptUrl(req, params.id, token),
      expires_at:     invite.expiresAt,
      used_at:        invite.usedAt,
      revoked_at:     invite.revokedAt,
      state:          inviteState(invite, now),
      created_at:     invite.createdAt,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; actorId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const actor = await prisma.liveActor.findFirst({
      where:  { id: params.actorId, oaId: params.id },
      select: { id: true },
    });
    if (!actor) return notFound("Actor が見つかりません");

    const now = new Date();
    const result = await prisma.liveActorInvite.updateMany({
      where: {
        actorId:    params.actorId,
        usedAt:     null,
        revokedAt:  null,
      },
      data: { revokedAt: now },
    });
    return ok({ revoked_count: result.count });
  } catch (err) {
    return serverError(err);
  }
}
