// src/app/api/external/v1/works/[workId]/phase-links/route.ts
//
// GET /api/external/v1/works/:workId/phase-links
//   指定作品（active かつ allowlist 内 OA）の、管理/Live(Staff) 画面へのリンク一覧を返す。
//
//   - work レベル: scenarioUrl / liveAdminUrl / liveActorUrl（Live/Staff 画面は作品単位）
//   - phase レベル: adminUrl（フェーズ編集画面・フェーズ単位）
//
// 読み取り専用。x-whale-api-key 必須。URL 文字列を返すだけで、開く人は従来の Auth+RBAC で保護される。
// 存在しないフェーズ別 Staff URL は返さない。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { requireExternalApiKey } from "@/lib/external-auth";
import {
  buildPhaseAdminUrl,
  buildScenarioUrl,
  buildLiveAdminUrl,
  buildLiveActorUrl,
} from "@/lib/external-links";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: { workId: string } }) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const workId = ctx.params.workId;

    const work = await prisma.work.findUnique({
      where:  { id: workId },
      select: { id: true, oaId: true, title: true, publishStatus: true },
    });

    if (!work || work.publishStatus !== "active" || !scope.allowsOa(work.oaId)) {
      return notFound("作品");
    }

    const phases = await prisma.phase.findMany({
      where:   { workId, phaseType: { not: "global" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select:  { id: true, phaseKey: true, name: true, sortOrder: true },
    });

    return ok({
      work: {
        id:    work.id,
        oaId:  work.oaId,
        title: work.title,
      },
      // 作品単位のリンク（Live/Staff 画面はフェーズ単位 URL を持たない）
      links: {
        scenarioUrl:  buildScenarioUrl(work.oaId, work.id),
        liveAdminUrl: buildLiveAdminUrl(work.oaId, work.id),
        liveActorUrl: buildLiveActorUrl(work.oaId, work.id),
      },
      // フェーズ単位のリンク（adminUrl = フェーズ編集画面）
      phases: phases.map((p) => ({
        id:       p.id,
        key:      p.phaseKey,
        name:     p.name,
        order:    p.sortOrder,
        adminUrl: buildPhaseAdminUrl(work.oaId, work.id, p.id),
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}
