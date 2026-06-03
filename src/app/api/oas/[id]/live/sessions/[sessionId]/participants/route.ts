// src/app/api/oas/:id/live/sessions/:sessionId/participants/route.ts
// GET  — セッションの参加者一覧
// POST — 参加者追加
//
// 認可は親と同じ (platform admin / OA owner / live_owner / live_admin)。
// 親セッションが該当 OA に紐付いていることを確認 (= 他 OA への横断アクセス防止)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createParticipantSchema = z.object({
  display_name:  z.string().min(1).max(120).optional().nullable(),
  line_user_id:  z.string().min(1).max(120).optional().nullable(),
  // Phase 2-B.5: Supabase Auth 紐付け
  auth_user_id:  z.string().min(1).max(120).optional().nullable(),
  email:         z.string().email("email の形式が不正です").max(254).optional().nullable(),
  status:        z.enum(["waiting", "active", "stuck", "completed", "dropped"]).optional(),
  current_step:  z.string().max(200).optional().nullable(),
});

type ParticipantRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  displayName: string | null;
  lineUserId: string | null;
  authUserId: string | null;
  email: string | null;
  status: string;
  currentStep: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(p: ParticipantRow) {
  return {
    id:               p.id,
    oa_id:            p.oaId,
    live_session_id:  p.liveSessionId,
    display_name:     p.displayName,
    line_user_id:     p.lineUserId,
    auth_user_id:     p.authUserId,
    email:            p.email,
    status:           p.status,
    current_step:     p.currentStep,
    last_seen_at:     p.lastSeenAt,
    created_at:       p.createdAt,
    updated_at:       p.updatedAt,
  };
}

async function ensureSessionBelongsToOa(sessionId: string, oaId: string) {
  return prisma.liveSession.findFirst({
    where:  { id: sessionId, oaId },
    select: { id: true },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  const session = await ensureSessionBelongsToOa(params.sessionId, params.id);
  if (!session) return notFound("LiveSession");

  try {
    const participants = await prisma.liveParticipant.findMany({
      where:   { liveSessionId: params.sessionId },
      orderBy: { createdAt: "asc" },
      take:    500,
    });
    return ok({ participants: participants.map(toResponse) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const session = await ensureSessionBelongsToOa(params.sessionId, params.id);
  if (!session) return notFound("LiveSession");

  try {
    const body = await req.json();
    const data = createParticipantSchema.parse(body);
    const participant = await prisma.liveParticipant.create({
      data: {
        oaId:          params.id,
        liveSessionId: params.sessionId,
        displayName:   data.display_name  ?? null,
        lineUserId:    data.line_user_id  ?? null,
        authUserId:    data.auth_user_id  ?? null,
        email:         data.email         ?? null,
        status:        data.status        ?? "waiting",
        currentStep:   data.current_step  ?? null,
      },
    });
    return created(toResponse(participant));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
