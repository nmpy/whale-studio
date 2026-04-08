// src/app/api/works/[workId]/destinations/[destinationId]/usages/route.ts
// GET — destination の使用箇所一覧

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { getDestinationUsages } from "@/lib/destination-usage-utils";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId, destinationId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const dest = await prisma.lineDestination.findUnique({ where: { id: destinationId } });
    if (!dest || dest.workId !== workId) return notFound("Destination");

    const usages = await getDestinationUsages(destinationId, workId);
    return ok(usages);
  } catch (err) {
    return serverError(err);
  }
});
