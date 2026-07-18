// POST /api/admin/error-log/resolve — エラーログ 1 件を解決（platform owner 限定）。
// body: { source, sourceId }。oaId / resolvedBy はクライアントから受け取らずサーバーで導出。

import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { ok, forbidden, badRequest, unprocessable, serverError } from "@/lib/api-response";
import { resolveError, isValidSource } from "@/lib/owner-error-log/resolve-service";
import { writeErrorLogAudit } from "@/lib/owner-error-log/audit";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return forbidden(); // workspace owner も不可（strict）

    const body = await req.json().catch(() => null);
    const source = body?.source;
    const sourceId = body?.sourceId;
    if (!isValidSource(source) || typeof sourceId !== "string" || !sourceId) {
      return badRequest("source / sourceId が不正です");
    }

    const res = await resolveError(source, sourceId, user.id);
    if (!res.ok) {
      return unprocessable("対象の失敗ログが見つからないか、失敗状態ではありません", "NOT_RESOLVABLE");
    }

    await writeErrorLogAudit({ actorId: user.id, operation: "resolve", source, sourceId, detail: { oaId: res.oaId } });

    return ok({ isResolved: true, resolvedAt: res.resolvedAt });
  } catch (err) {
    return serverError(err);
  }
});
