// src/app/api/oas/[id]/live/sessions/[sessionId]/route.ts
// GET    /api/oas/:id/live/sessions/:sessionId — 単一 Live セッション取得
// PATCH  /api/oas/:id/live/sessions/:sessionId — 公演 lifecycle 編集（status / name / 開始終了時刻）
// DELETE /api/oas/:id/live/sessions/:sessionId — 公演削除
//
// 認可: GET=read 集合 / PATCH・DELETE=write 集合（platform admin / OA owner / live_owner / live_admin）。
// Live 無効 OA / 権限なし / 別OA の session は 404 で存在を露出しない。
//
// PR2a（Live Mode エピック）: これまで sessions は作成のみで status が draft のまま固定だった。
//   公演の開始(active)/終了(ended)・時刻編集を可能にし、以降の Runtime→Live 同期を
//   「status=active の公演」に束ねられるようにする（同期本体は PR2b）。

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { patchLiveSessionSchema } from "@/lib/live-session-lifecycle";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  oaId: string;
  workId: string | null;
  name: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  work: { id: string; title: string } | null;
};

function toResponse(s: SessionRow) {
  return {
    id:         s.id,
    oa_id:      s.oaId,
    work_id:    s.workId,
    work_title: s.work?.title ?? null,
    name:       s.name,
    status:     s.status,
    starts_at:  s.startsAt,
    ends_at:    s.endsAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

/** 指定 session が当該 OA に属するか確認して返す（別 OA / 不在は null）。 */
async function findSession(sessionId: string, oaId: string): Promise<SessionRow | null> {
  const s = await prisma.liveSession.findUnique({
    where:   { id: sessionId },
    include: { work: { select: { id: true, title: true } } },
  });
  if (!s || s.oaId !== oaId) return null;
  return s as unknown as SessionRow;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  const existing = await findSession(params.sessionId, params.id);
  if (!existing) return notFound("LiveSession");
  return ok(toResponse(existing));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findSession(params.sessionId, params.id);
  if (!existing) return notFound("LiveSession");

  try {
    const body = await req.json();
    const data = patchLiveSessionSchema.parse(body);

    const updated = await prisma.liveSession.update({
      where: { id: params.sessionId },
      data: {
        ...(data.name      !== undefined ? { name:   data.name }   : {}),
        ...(data.status    !== undefined ? { status: data.status } : {}),
        ...(data.starts_at !== undefined ? { startsAt: data.starts_at ? new Date(data.starts_at) : null } : {}),
        ...(data.ends_at   !== undefined ? { endsAt:   data.ends_at   ? new Date(data.ends_at)   : null } : {}),
      },
      include: { work: { select: { id: true, title: true } } },
    });
    return ok(toResponse(updated as unknown as SessionRow));
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findSession(params.sessionId, params.id);
  if (!existing) return notFound("LiveSession");

  try {
    // participants / teams / assignments / events は onDelete 設定に従う（schema 参照）。
    await prisma.liveSession.delete({ where: { id: params.sessionId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
}
