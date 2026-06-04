// src/app/api/oas/[id]/live/scripts/route.ts
// GET  — LiveScript 一覧 (= work_id query で絞り込み可)
// POST — LiveScript 作成
//
// 認可: live admin 集合 (= authorizeLive)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createScriptSchema = z.object({
  work_id:   z.string().uuid().optional().nullable(),
  title:     z.string().min(1, "title は必須です").max(200),
  body:      z.string().min(1, "body は必須です").max(20000),
  memo:      z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
});

type ScriptRow = {
  id: string;
  oaId: string;
  workId: string | null;
  title: string;
  body: string;
  memo: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(s: ScriptRow) {
  return {
    id:         s.id,
    oa_id:      s.oaId,
    work_id:    s.workId,
    title:      s.title,
    body:       s.body,
    memo:       s.memo,
    is_active:  s.isActive,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const workId = url.searchParams.get("work_id");
    const scripts = await prisma.liveScript.findMany({
      where:   workId ? { oaId: params.id, workId } : { oaId: params.id },
      orderBy: { createdAt: "asc" },
      take:    200,
    });
    return ok({ scripts: scripts.map(toResponse) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const data = createScriptSchema.parse(body);

    if (data.work_id) {
      const w = await prisma.work.findFirst({
        where:  { id: data.work_id, oaId: params.id },
        select: { id: true },
      });
      if (!w) return badRequest("work_id が OA に紐付いていません");
    }

    const script = await prisma.liveScript.create({
      data: {
        oaId:     params.id,
        workId:   data.work_id ?? null,
        title:    data.title,
        body:     data.body,
        memo:     data.memo ?? null,
        isActive: data.is_active ?? true,
      },
    });
    return created(toResponse(script));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
