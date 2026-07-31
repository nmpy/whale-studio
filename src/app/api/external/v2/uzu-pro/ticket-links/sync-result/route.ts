// POST /api/external/v2/uzu-pro/ticket-links/sync-result
//   for ウズプロ: UZU Pro CMS の「Whale連携確認」の結果を Whale Studio へ書き戻す。
//
//   認証: write 用ガード requireExternalWriteApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_WRITE_API_KEY）+
//         WHALE_EXTERNAL_OA_IDS allowlist。fail closed。
//
//   冪等性:
//     - 同一 Idempotency-Key の再送は再処理せず replay を返す（既存 bookings/sync と同じ reserve-first）。
//     - キー無しで再送された場合も、状態と uzuSyncedAt の設定は同じ値を書くだけなので二重反映にならない。
//     - ERROR は uzuSyncedAt を進めない（次回の差分取得で再試行できるようにする）。
//
//   個人情報は受け取らない。strict schema で未知フィールドを 400 拒否する。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import type { TicketLinkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalWriteApiKey } from "@/lib/external-auth";
import { recordUzuProActivity } from "@/lib/uzupro/activity";
import { canTransitionLink } from "@/lib/ticket-link/rules";

export const dynamic = "force-dynamic";

const resultSchema = z
  .object({
    whaleTicketLinkId: z.string().min(1).max(100),
    result:            z.enum(["LINKED", "PENDING_BOOKING", "CONFLICT", "NO_CHANGE", "ERROR"]),
    /** 失敗理由コード（PII を含めない。自由記述は受け取らない）。 */
    errorCode:         z.string().min(1).max(100).optional(),
    /** CMS 側の作品/プロジェクト識別子（監査用）。 */
    uzuWorkId:         z.string().min(1).max(200).optional(),
  })
  .strict();

const bodySchema = z
  .object({
    workId:  z.string().min(1).max(100),
    results: z.array(resultSchema).min(1).max(500),
  })
  .strict();

/** 同期結果 → 連携状態。NO_CHANGE / ERROR は状態を動かさない。 */
function targetStatusFor(result: string): TicketLinkStatus | null {
  switch (result) {
    case "LINKED":          return "LINKED";
    case "PENDING_BOOKING": return "PENDING_UZU_BOOKING";
    case "CONFLICT":        return "CONFLICT";
    default:                return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = requireExternalWriteApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  let idempotencyKey: string | null = null;

  try {
    const data = bodySchema.parse(await req.json());

    const work = await prisma.work.findUnique({
      where: { id: data.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    // Idempotency-Key（任意）: reserve-first。同一キーの再送は再処理せず replay を返す。
    const rawIdemKey = req.headers.get("idempotency-key");
    idempotencyKey = rawIdemKey && rawIdemKey.trim().length > 0 ? rawIdemKey.trim() : null;
    const rawRequestId = req.headers.get("x-request-id");
    const requestId = rawRequestId && rawRequestId.trim().length > 0 ? rawRequestId.trim() : null;

    if (idempotencyKey) {
      try {
        await prisma.uzuProSyncRequest.create({
          data: {
            idempotencyKey,
            requestId,
            oaId:   work.oaId,
            workId: work.id,
            status: "received",
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return ok({ idempotent_replay: true });
        }
        throw err;
      }
    }

    const now = new Date();
    const counts = { applied: 0, skipped: 0, notFound: 0, errors: 0 };

    // 対象 work 配下の連携だけを触る（他テナントの id を渡されても反映しない）。
    for (const r of data.results) {
      const link = await prisma.ticketLink.findFirst({
        where: { id: r.whaleTicketLinkId, workId: work.id },
        select: { id: true, status: true },
      });
      if (!link) { counts.notFound += 1; continue; }

      const target = targetStatusFor(r.result);
      const nextStatus =
        target && target !== link.status && canTransitionLink(link.status, target) ? target : null;

      // ERROR は同期済みにしない（次回の差分取得で再試行させる）。
      const markSynced = r.result !== "ERROR";

      await prisma.$transaction(async (tx) => {
        if (nextStatus || markSynced) {
          await tx.ticketLink.update({
            where: { id: link.id },
            data: {
              ...(nextStatus ? { status: nextStatus } : {}),
              ...(markSynced ? { uzuSyncedAt: now } : {}),
            },
          });
        }
        await tx.ticketLinkSyncLog.create({
          data: {
            ticketLinkId: link.id,
            uzuWorkId:    r.uzuWorkId ?? null,
            result:       r.result,
            errorCode:    r.errorCode ?? null,
            syncedAt:     now,
          },
        });
      });

      if (r.result === "ERROR") counts.errors += 1;
      else if (nextStatus || markSynced) counts.applied += 1;
      else counts.skipped += 1;
    }

    if (idempotencyKey) {
      await prisma.uzuProSyncRequest.update({
        where: { idempotencyKey },
        data: { status: "processed", processedAt: new Date() },
      });
    }

    // 監査ログ（PII 非含有: 件数のみ）。
    await recordUzuProActivity(prisma, {
      oaId:       work.oaId,
      workId:     work.id,
      action:     "sync_success",
      targetType: "sync",
      detail:     { kind: "ticket_link_sync_result", ...counts },
    });

    return ok(counts);
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト内容が不正です");
    if (idempotencyKey) {
      await prisma.uzuProSyncRequest
        .update({ where: { idempotencyKey }, data: { status: "failed", processedAt: new Date() } })
        .catch(() => undefined);
    }
    console.error("[external/v2/uzu-pro/ticket-links/sync-result] error:", err);
    return serverError(err);
  }
}
