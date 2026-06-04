// src/app/api/oas/[id]/live/actors/route.ts
// GET  /api/oas/:id/live/actors — OA 内の Actor (= 演者) レコード一覧
// POST /api/oas/:id/live/actors — Actor 作成
//
// 認可: live admin 集合 (= authorizeLive / platform admin / OA owner / live_owner / live_admin)
//
// Phase 2-J: 各 Actor について「最新 invite」と派生 state (none/active/used/expired/revoked)
// を一緒に返す。invite token 本体は決して返さない (= hash のみ DB 保存)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { inviteState, type InviteState } from "@/lib/live-actor-invite";

export const dynamic = "force-dynamic";

const createActorSchema = z.object({
  display_name:   z.string().min(1, "display_name は必須です").max(120),
  user_id:        z.string().min(1).max(120).optional().nullable(),
  character_name: z.string().max(120).optional().nullable(),
  memo:           z.string().max(2000).optional().nullable(),
});

type ActorRow = {
  id: string;
  oaId: string;
  displayName: string;
  userId: string | null;
  characterName: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ActorInviteSummary = {
  state: InviteState;
  expires_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date | null;
};

function toResponse(a: ActorRow, inviteInfo: ActorInviteSummary) {
  return {
    id:             a.id,
    oa_id:          a.oaId,
    display_name:   a.displayName,
    user_id:        a.userId,
    character_name: a.characterName,
    memo:           a.memo,
    created_at:     a.createdAt,
    updated_at:     a.updatedAt,
    // Phase 2-J: 最新 invite の派生 state
    invite_state:        inviteInfo.state,
    invite_expires_at:   inviteInfo.expires_at,
    invite_used_at:      inviteInfo.used_at,
    invite_revoked_at:   inviteInfo.revoked_at,
    invite_created_at:   inviteInfo.created_at,
  };
}

const emptyInviteSummary: ActorInviteSummary = {
  state: "none",
  expires_at: null,
  used_at: null,
  revoked_at: null,
  created_at: null,
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  try {
    const actors = await prisma.liveActor.findMany({
      where:   { oaId: params.id },
      orderBy: { createdAt: "asc" },
      include: {
        invites: {
          orderBy: { createdAt: "desc" },
          take:    1,
        },
      },
      take: 200,
    });

    const now = new Date();
    return ok({
      actors: actors.map((a) => {
        const inv = a.invites[0] ?? null;
        const summary: ActorInviteSummary = inv
          ? {
              state:       inviteState(inv, now),
              expires_at:  inv.expiresAt,
              used_at:     inv.usedAt,
              revoked_at:  inv.revokedAt,
              created_at:  inv.createdAt,
            }
          : emptyInviteSummary;
        return toResponse(a, summary);
      }),
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const data = createActorSchema.parse(body);
    const actor = await prisma.liveActor.create({
      data: {
        oaId:          params.id,
        displayName:   data.display_name,
        userId:        data.user_id        ?? null,
        characterName: data.character_name ?? null,
        memo:          data.memo           ?? null,
      },
    });
    return created(toResponse(actor, emptyInviteSummary));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
