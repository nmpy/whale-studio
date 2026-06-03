// src/app/api/oas/[id]/live/sessions/[sessionId]/assignments/[assignmentId]/route.ts
// DELETE — 担当割当の解除
//
// 認可: live admin 集合 (= platform admin / OA owner / live_owner / live_admin)
// 横断アクセス防止のため、assignment が指定 session / OA 配下であることを毎回検証する。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; assignmentId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await prisma.liveAssignment.findFirst({
    where:  { id: params.assignmentId, liveSessionId: params.sessionId, oaId: params.id },
    select: { id: true },
  });
  if (!existing) return notFound("LiveAssignment");

  try {
    await prisma.liveAssignment.delete({ where: { id: params.assignmentId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
}
