// src/app/api/oas/[id]/live/cues/[cueId]/route.ts
// PATCH  — LiveCue 編集
// DELETE — LiveCue 削除
//
// 認可: live admin 集合。oaId 整合性チェックあり。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchCueSchema = z.object({
  work_id:    z.string().uuid().optional().nullable(),
  phase_id:   z.string().uuid().optional().nullable(),
  actor_id:   z.string().uuid().optional().nullable(),
  title:      z.string().min(1).max(200).optional(),
  body:       z.string().min(1).max(5000).optional(),
  priority:   z.enum(["low", "normal", "high"]).optional(),
  sort_order: z.number().int().optional(),
  is_active:  z.boolean().optional(),
}).refine(
  (v) =>
    v.work_id    !== undefined ||
    v.phase_id   !== undefined ||
    v.actor_id   !== undefined ||
    v.title      !== undefined ||
    v.body       !== undefined ||
    v.priority   !== undefined ||
    v.sort_order !== undefined ||
    v.is_active  !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

type CueRow = {
  id: string;
  oaId: string;
  workId: string | null;
  phaseId: string | null;
  actorId: string | null;
  title: string;
  body: string;
  priority: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(c: CueRow) {
  return {
    id:         c.id,
    oa_id:      c.oaId,
    work_id:    c.workId,
    phase_id:   c.phaseId,
    actor_id:   c.actorId,
    title:      c.title,
    body:       c.body,
    priority:   c.priority,
    sort_order: c.sortOrder,
    is_active:  c.isActive,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

async function findCue(cueId: string, oaId: string) {
  return prisma.liveCue.findFirst({
    where:  { id: cueId, oaId },
    select: { id: true, workId: true },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cueId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findCue(params.cueId, params.id);
  if (!existing) return notFound("LiveCue");

  try {
    const body = await req.json();
    const data = patchCueSchema.parse(body);

    // workId 変更 or 既存 workId に対する phase / actor の整合性
    const effectiveWorkId = data.work_id !== undefined ? data.work_id : existing.workId;
    if (data.work_id) {
      const w = await prisma.work.findFirst({
        where:  { id: data.work_id, oaId: params.id },
        select: { id: true },
      });
      if (!w) return badRequest("work_id が OA に紐付いていません");
    }
    if (data.phase_id) {
      const ph = await prisma.phase.findFirst({
        where:  effectiveWorkId
          ? { id: data.phase_id, workId: effectiveWorkId }
          : { id: data.phase_id },
        select: { id: true },
      });
      if (!ph) return badRequest("phase_id がその作品のフェーズではありません");
    }
    if (data.actor_id) {
      const a = await prisma.liveActor.findFirst({
        where:  { id: data.actor_id, oaId: params.id },
        select: { id: true },
      });
      if (!a) return badRequest("actor_id が OA に紐付いていません");
    }

    const updated = await prisma.liveCue.update({
      where: { id: params.cueId },
      data: {
        ...(data.work_id    !== undefined ? { workId:    data.work_id } : {}),
        ...(data.phase_id   !== undefined ? { phaseId:   data.phase_id } : {}),
        ...(data.actor_id   !== undefined ? { actorId:   data.actor_id } : {}),
        ...(data.title      !== undefined ? { title:     data.title } : {}),
        ...(data.body       !== undefined ? { body:      data.body } : {}),
        ...(data.priority   !== undefined ? { priority:  data.priority } : {}),
        ...(data.sort_order !== undefined ? { sortOrder: data.sort_order } : {}),
        ...(data.is_active  !== undefined ? { isActive:  data.is_active } : {}),
      },
    });
    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; cueId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findCue(params.cueId, params.id);
  if (!existing) return notFound("LiveCue");

  try {
    await prisma.liveCue.delete({ where: { id: params.cueId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
}
