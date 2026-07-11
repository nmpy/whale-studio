// src/app/api/external/v1/works/route.ts
//
// GET /api/external/v1/works
//   外部連携対象（WHALE_EXTERNAL_OA_IDS allowlist 内 OA）の **active** 作品一覧を返す。
//
// 読み取り専用。x-whale-api-key 必須。返却は camelCase・最小限のみ。
// runtime / webhook / phase transition / puzzle 判定 / scheduled messages には一切関与しない。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { requireExternalApiKey } from "@/lib/external-auth";

export const dynamic = "force-dynamic";

// フェーズ数は player 向けフェーズ（global を除く）を数える = /phases エンドポイントの返却集合と一致させる。
const NON_GLOBAL = { not: "global" as const };

export async function GET(req: NextRequest) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    // allowlist が空（未設定）なら fail closed = 何も返さない。
    if (scope.oaIds.length === 0) return ok({ works: [] });

    const works = await prisma.work.findMany({
      where: { oaId: { in: scope.oaIds }, publishStatus: "active" },
      orderBy: [{ oaId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id:            true,
        publicId:      true,
        oaId:          true,
        title:         true,
        publishStatus: true,
        sortOrder:     true,
      },
    });

    // phaseCount を groupBy で一括集計（global 除外）。N+1 を避ける。
    const workIds = works.map((w) => w.id);
    const counts = workIds.length
      ? await prisma.phase.groupBy({
          by:     ["workId"],
          where:  { workId: { in: workIds }, phaseType: NON_GLOBAL },
          _count: { _all: true },
        })
      : [];
    const countByWork = new Map(counts.map((c) => [c.workId, c._count._all]));

    const payload = works.map((w) => ({
      id:            w.id,
      publicId:      w.publicId,
      oaId:          w.oaId,
      title:         w.title,
      publishStatus: w.publishStatus,
      sortOrder:     w.sortOrder,
      phaseCount:    countByWork.get(w.id) ?? 0,
    }));

    return ok({ works: payload });
  } catch (err) {
    return serverError(err);
  }
}
