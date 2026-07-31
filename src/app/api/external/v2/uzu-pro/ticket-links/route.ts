// GET /api/external/v2/uzu-pro/ticket-links
//   for ウズプロ: UZU Pro CMS の「Whale連携確認」が、Whale Studio 側の確定済みチケット連携を取得する。
//
//   認証: read 用ガード requireExternalApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_API_KEY）+
//         WHALE_EXTERNAL_OA_IDS allowlist（scope.allowsOa）でテナント境界を検証。fail closed。
//
//   返す情報は「予約と LINE を突き合わせるのに必要な最小限」だけ。
//   OCR 原文 / 購入者名 / 公演名 / 会場 は **返さない**（そもそも TicketLink に保存していない）。
//   内部主キーのうち外部へ出すのは whaleTicketLinkId（同期結果の宛先）のみ。
//
//   取得条件: 対象作品 / 未同期のみ / 更新日時以降 / カーソルページング / 最大取得件数。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalApiKey } from "@/lib/external-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const querySchema = z.object({
  workId: z.string().min(1).max(100),
  /** true（既定）= 未同期 or 同期後に更新された分のみ返す。 */
  unsyncedOnly: z.enum(["true", "false"]).optional(),
  /** この日時より後に更新されたものだけ返す（ISO8601）。 */
  updatedSince: z.string().datetime({ offset: true }).optional(),
  /** 直前ページ末尾の whaleTicketLinkId。 */
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

export async function GET(req: NextRequest) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const url = new URL(req.url);
    const params = querySchema.parse({
      workId:       url.searchParams.get("workId") ?? undefined,
      unsyncedOnly: url.searchParams.get("unsyncedOnly") ?? undefined,
      updatedSince: url.searchParams.get("updatedSince") ?? undefined,
      cursor:       url.searchParams.get("cursor") ?? undefined,
      limit:        url.searchParams.get("limit") ?? undefined,
    });

    // work → OA を導出し allowlist を検証。存在秘匿のため未許可/不在は一律 404。
    const work = await prisma.work.findUnique({
      where: { id: params.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    const limit = params.limit ?? DEFAULT_LIMIT;
    const unsyncedOnly = params.unsyncedOnly !== "false";

    // REVOKED は同期対象外（運営が無効化した連携を CMS へ流さない）。
    const where: Record<string, unknown> = {
      workId: work.id,
      status: { in: ["PENDING_UZU_BOOKING", "LINKED", "CONFLICT"] },
    };
    if (params.updatedSince) {
      where.updatedAt = { gt: new Date(params.updatedSince) };
    }
    if (unsyncedOnly) {
      // 未同期（uzuSyncedAt = null）のみを対象にする。
      // 「同期後に更新された分」は CMS 側が updatedSince カーソルで拾う。
      where.uzuSyncedAt = null;
    }

    const rows = await prisma.ticketLink.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1, // 次ページ有無の判定用に 1 件多く取る
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        workId: true,
        lineUserId: true,
        lineDisplayName: true,
        normalizedReservationNumber: true,
        ticketType: true,
        participantCount: true,
        source: true,
        status: true,
        confirmedAt: true,
        updatedAt: true,
        members: {
          orderBy: { memberIndex: "asc" },
          select: { memberIndex: true, codeName: true },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = page.map((r) => ({
      whaleTicketLinkId: r.id,
      externalWorkId:    r.workId,
      reservationNumber: r.normalizedReservationNumber,
      lineUserId:        r.lineUserId,
      lineDisplayName:   r.lineDisplayName,
      ticketType:        r.ticketType,
      participantCount:  r.participantCount,
      codeNames:         r.members.map((m) => m.codeName),
      source:            r.source,
      status:            r.status,
      confirmedAt:       r.confirmedAt.toISOString(),
      updatedAt:         r.updatedAt.toISOString(),
    }));

    return ok(items, {
      next_cursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      has_more:    hasMore,
      limit,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です");
    console.error("[external/v2/uzu-pro/ticket-links] error:", err);
    return serverError(err);
  }
}
