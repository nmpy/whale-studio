// src/app/api/external/v1/works/[workId]/phases/route.ts
//
// GET /api/external/v1/works/:workId/phases
//   指定作品（active かつ allowlist 内 OA）のフェーズ一覧を返す。
//
// 読み取り専用。x-whale-api-key 必須。返却は camelCase・最小限のみ。
// 返さないもの: message 本文 / puzzle 正解 / transition 条件 / startTrigger / resumeSummary 等。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { requireExternalApiKey } from "@/lib/external-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: { workId: string } }) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const workId = ctx.params.workId;

    const work = await prisma.work.findUnique({
      where:  { id: workId },
      select: { id: true, publicId: true, oaId: true, title: true, publishStatus: true },
    });

    // 存在しない / 非 active / allowlist 外 OA は一律 404（存在有無を漏らさない）。
    if (!work || work.publishStatus !== "active" || !scope.allowsOa(work.oaId)) {
      return notFound("作品");
    }

    const phases = await prisma.phase.findMany({
      where:   { workId, phaseType: { not: "global" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select:  {
        id:        true,
        phaseKey:  true,
        name:      true,
        phaseType: true,
        sortOrder: true,
        isActive:  true,
      },
    });

    return ok({
      work: {
        id:       work.id,
        publicId: work.publicId,
        oaId:     work.oaId,
        title:    work.title,
      },
      phases: phases.map((p) => ({
        id:        p.id,
        key:       p.phaseKey,
        name:      p.name,
        phaseType: p.phaseType,
        order:     p.sortOrder,
        isActive:  p.isActive,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}
