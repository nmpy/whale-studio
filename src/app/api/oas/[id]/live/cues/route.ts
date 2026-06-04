// src/app/api/oas/[id]/live/cues/route.ts
// GET  — LiveCue 一覧 (= work_id query で絞り込み可)
// POST — LiveCue 作成
//
// 認可: live admin 集合 (= authorizeLive)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createCueSchema = z.object({
  work_id:    z.string().uuid().optional().nullable(),
  phase_id:   z.string().uuid().optional().nullable(),
  actor_id:   z.string().uuid().optional().nullable(),
  title:      z.string().min(1, "title は必須です").max(200),
  body:       z.string().min(1, "body は必須です").max(5000),
  priority:   z.enum(["low", "normal", "high"]).optional(),
  sort_order: z.number().int().optional(),
  is_active:  z.boolean().optional(),
});

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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const workId = url.searchParams.get("work_id");
    const cues = await prisma.liveCue.findMany({
      where:   workId ? { oaId: params.id, workId } : { oaId: params.id },
      orderBy: [{ priority: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      take:    500,
    });
    return ok({ cues: cues.map(toResponse) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const data = createCueSchema.parse(body);

    if (data.work_id) {
      const w = await prisma.work.findFirst({
        where:  { id: data.work_id, oaId: params.id },
        select: { id: true },
      });
      if (!w) return badRequest("work_id が OA に紐付いていません");
    }
    if (data.phase_id) {
      const ph = await prisma.phase.findFirst({
        where:  data.work_id
          ? { id: data.phase_id, workId: data.work_id }
          : { id: data.phase_id },
        select: { id: true },
      });
      if (!ph) return badRequest("phase_id が(work_id 指定時は)その作品のフェーズではありません");
    }
    if (data.actor_id) {
      const a = await prisma.liveActor.findFirst({
        where:  { id: data.actor_id, oaId: params.id },
        select: { id: true },
      });
      if (!a) return badRequest("actor_id が OA に紐付いていません");
    }

    const cue = await prisma.liveCue.create({
      data: {
        oaId:      params.id,
        workId:    data.work_id ?? null,
        phaseId:   data.phase_id ?? null,
        actorId:   data.actor_id ?? null,
        title:     data.title,
        body:      data.body,
        priority:  data.priority ?? "normal",
        sortOrder: data.sort_order ?? 0,
        isActive:  data.is_active ?? true,
      },
    });
    return created(toResponse(cue));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
