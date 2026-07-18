// POST /api/admin/error-log/reopen — 解決済みエラーログを再オープン（platform owner 限定）。
// body: { source, sourceId }。対応する解決行を削除（idempotent）。

import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { ok, forbidden, badRequest, serverError } from "@/lib/api-response";
import { reopenError, isValidSource } from "@/lib/owner-error-log/resolve-service";
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

    const res = await reopenError(source, sourceId);
    if (!res.ok) return badRequest("source / sourceId が不正です");

    await writeErrorLogAudit({ actorId: user.id, operation: "reopen", source, sourceId, detail: { oaId: res.oaId } });

    return ok({ isResolved: false });
  } catch (err) {
    return serverError(err);
  }
});
