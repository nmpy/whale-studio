// src/app/api/oas/[id]/live/actors/route.ts
// GET  /api/oas/:id/live/actors — OA 内の Actor (= 演者) レコード一覧
// POST /api/oas/:id/live/actors — Actor 作成
//
// 認可: live admin 集合 (= authorizeLive / platform admin / OA owner / live_owner / live_admin)

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

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

function toResponse(a: ActorRow) {
  return {
    id:             a.id,
    oa_id:          a.oaId,
    display_name:   a.displayName,
    user_id:        a.userId,
    character_name: a.characterName,
    memo:           a.memo,
    created_at:     a.createdAt,
    updated_at:     a.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  try {
    const actors = await prisma.liveActor.findMany({
      where:   { oaId: params.id },
      orderBy: { createdAt: "asc" },
      take:    200,
    });
    return ok({ actors: actors.map(toResponse) });
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
    return created(toResponse(actor));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
