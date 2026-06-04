// src/app/api/oas/[id]/live/scripts/[scriptId]/route.ts
// PATCH  — LiveScript 編集
// DELETE — LiveScript 削除
//
// 認可: live admin 集合。oaId 整合性チェックあり。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchScriptSchema = z.object({
  work_id:   z.string().uuid().optional().nullable(),
  title:     z.string().min(1).max(200).optional(),
  body:      z.string().min(1).max(20000).optional(),
  memo:      z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
}).refine(
  (v) =>
    v.work_id   !== undefined ||
    v.title     !== undefined ||
    v.body      !== undefined ||
    v.memo      !== undefined ||
    v.is_active !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

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

async function findScript(scriptId: string, oaId: string) {
  return prisma.liveScript.findFirst({
    where:  { id: scriptId, oaId },
    select: { id: true },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; scriptId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findScript(params.scriptId, params.id);
  if (!existing) return notFound("LiveScript");

  try {
    const body = await req.json();
    const data = patchScriptSchema.parse(body);

    if (data.work_id) {
      const w = await prisma.work.findFirst({
        where:  { id: data.work_id, oaId: params.id },
        select: { id: true },
      });
      if (!w) return badRequest("work_id が OA に紐付いていません");
    }

    const updated = await prisma.liveScript.update({
      where: { id: params.scriptId },
      data: {
        ...(data.work_id   !== undefined ? { workId:   data.work_id } : {}),
        ...(data.title     !== undefined ? { title:    data.title } : {}),
        ...(data.body      !== undefined ? { body:     data.body } : {}),
        ...(data.memo      !== undefined ? { memo:     data.memo } : {}),
        ...(data.is_active !== undefined ? { isActive: data.is_active } : {}),
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
  { params }: { params: { id: string; scriptId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findScript(params.scriptId, params.id);
  if (!existing) return notFound("LiveScript");

  try {
    await prisma.liveScript.delete({ where: { id: params.scriptId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
}
