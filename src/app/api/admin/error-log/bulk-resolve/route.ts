// POST /api/admin/error-log/bulk-resolve — 表示中の未解決を一括解決（platform owner 限定）。
// body: { items: [{ source, sourceId }] }。クライアントは「表示中ページの未解決」のみ送る想定で、
// サーバーは受信件数を上限で拘束し、各件を個別に検証・冪等 upsert する（oaId はサーバー導出）。

import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { ok, forbidden, badRequest, serverError } from "@/lib/api-response";
import { resolveError, isValidSource } from "@/lib/owner-error-log/resolve-service";
import { writeErrorLogAudit } from "@/lib/owner-error-log/audit";

export const dynamic = "force-dynamic";

/** 一括の受信上限（数千件を無制限にクライアントから受け取らない）。 */
const BULK_CAP = 200;

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return forbidden(); // workspace owner も不可（strict）

    const body = await req.json().catch(() => null);
    const rawItems = Array.isArray(body?.items) ? body.items : null;
    if (!rawItems || rawItems.length === 0) return badRequest("items が空です");
    if (rawItems.length > BULK_CAP) return badRequest(`一度に処理できるのは ${BULK_CAP} 件までです`);

    // 入力を検証済みペアへ正規化（不正な要素は除外）。
    const items: { source: Parameters<typeof resolveError>[0]; sourceId: string }[] = [];
    for (const it of rawItems) {
      if (isValidSource(it?.source) && typeof it?.sourceId === "string" && it.sourceId) {
        items.push({ source: it.source, sourceId: it.sourceId });
      }
    }
    if (items.length === 0) return badRequest("有効な対象がありません");

    let resolved = 0;
    let skipped = 0;
    const auditOaIds = new Set<string>();
    // 各件を個別に検証・冪等解決（1 件失敗が全体を止めない）。
    for (const it of items) {
      const res = await resolveError(it.source, it.sourceId, user.id);
      if (res.ok) { resolved++; auditOaIds.add(res.oaId); } else { skipped++; }
    }

    await writeErrorLogAudit({ actorId: user.id, operation: "bulk_resolve",
      detail: { requested: items.length, resolved, skipped, oaIds: [...auditOaIds] } });

    return ok({ resolved, skipped });
  } catch (err) {
    return serverError(err);
  }
});
