// POST /api/external/v2/uzu-pro/bookings/sync
//   for ウズプロ: UZU Pro CMS（正本）→ Whale Studio へ 1 予約分の予約/プレイヤーを冪等同期する。
//   認証: write 専用ガード requireExternalWriteApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_WRITE_API_KEY）+
//         WHALE_EXTERNAL_OA_IDS allowlist（scope.allowsOa）でテナント境界を検証。
//
//   個人情報（氏名・メール・電話・住所・備考・購入者名 等）は受け取らない。strict schema で未知フィールドを 400 拒否。
//   冪等: syncUzuProBooking が (oaId, workId, externalBookingId) / (bookingId, playerIndex) の複合 unique upsert で保証。
//         さらに任意 Idempotency-Key ヘッダで reserve-first（create→P2002 で再送検知）し、同一キー再送は再処理せず replay を返す。
//   巻き戻り防止: 受信 sourceUpdatedAt が保存済みより古ければ applied=false（何も上書きしない）。
//
//   外部契約（#591 準拠）: 内部主キー（bookingId / liveSessionId / player.id）は返さない。
//                         externalBookingId + playerIndex + outcome のみを返す。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalWriteApiKey } from "@/lib/external-auth";
import { syncUzuProBooking } from "@/lib/uzupro/sync";
import { recordUzuProActivity } from "@/lib/uzupro/activity";

export const dynamic = "force-dynamic";

// strict(): 未知フィールド（PII: name/email/phone/address/memo/purchaserName 等）は 400 で拒否する。
const playerSchema = z
  .object({
    playerIndex:      z.number().int().min(1),
    externalPlayerId: z.string().min(1).max(200).optional(),
    externalTicketId: z.string().min(1).max(200).optional(),
    status:           z.enum(["active", "cancelled"]).optional(),
  })
  .strict();

const bodySchema = z
  .object({
    workId: z.string().min(1).max(100),
    session: z
      .object({
        externalSessionRef: z.string().min(1).max(200),
        startsAt:           z.string().datetime({ offset: true }).nullish(),
        endsAt:             z.string().datetime({ offset: true }).nullish(),
      })
      .strict(),
    booking: z
      .object({
        externalBookingId: z.string().min(1).max(200),
        participantCount:  z.number().int().min(0),
        status:            z.enum(["confirmed", "waitlist", "cancelled", "attended"]),
        sourceUpdatedAt:   z.string().datetime({ offset: true }),
      })
      .strict(),
    players: z.array(playerSchema).min(0).max(200),
  })
  .strict();

export async function POST(req: NextRequest) {
  const auth = requireExternalWriteApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  let idempotencyKey: string | null = null;

  try {
    const data = bodySchema.parse(await req.json());

    // work → OA を導出し allowlist（テナント境界）を検証。存在秘匿のため未許可/不在は一律 404。
    const work = await prisma.work.findUnique({
      where: { id: data.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    const oaId = work.oaId;
    const workId = work.id;
    const externalBookingId = data.booking.externalBookingId;

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
            oaId,
            workId,
            externalBookingId,
            status: "received",
          },
        });
      } catch (err) {
        // P2002 = 同一 Idempotency-Key の再送 → 再処理せず replay。
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return ok({ idempotent_replay: true });
        }
        throw err;
      }
    }

    // 予約+プレイヤーを原子的に反映（サービスが冪等 upsert / 巻き戻り防止を担保）。
    const now = new Date();
    const result = await prisma.$transaction((tx) =>
      syncUzuProBooking(tx, {
        oaId,
        workId,
        externalSessionRef: data.session.externalSessionRef,
        sessionStartsAt:    data.session.startsAt ? new Date(data.session.startsAt) : null,
        sessionEndsAt:      data.session.endsAt ? new Date(data.session.endsAt) : null,
        externalBookingId,
        participantCount:   data.booking.participantCount,
        bookingStatus:      data.booking.status,
        sourceUpdatedAt:    new Date(data.booking.sourceUpdatedAt),
        players: data.players.map((p) => ({
          playerIndex:      p.playerIndex,
          externalPlayerId: p.externalPlayerId ?? null,
          externalTicketId: p.externalTicketId ?? null,
          status:           p.status,
        })),
        now,
      }),
    );

    if (idempotencyKey) {
      await prisma.uzuProSyncRequest.update({
        where: { idempotencyKey },
        data: { status: "processed", processedAt: new Date() },
      });
    }

    // 監査ログ（PII 非含有: 件数と匿名 ref のみ）。
    await recordUzuProActivity(prisma, {
      oaId,
      workId,
      action: "sync_success",
      targetType: "sync",
      targetId: externalBookingId,
      detail: {
        applied:          result.applied,
        bookingCreated:   result.bookingCreated,
        playersCreated:   result.playersCreated,
        playersUpdated:   result.playersUpdated,
        playersCancelled: result.playersCancelled,
        playersFailed:    result.playersFailed,
      },
    });

    // 外部契約: 内部主キー（bookingId / liveSessionId / player.id）は返さない。
    return ok({
      booking: {
        externalBookingId,
        status:           data.booking.status,
        participantCount: data.booking.participantCount,
        applied:          result.applied,
      },
      players: result.players,
      counts: {
        created:   result.playersCreated,
        updated:   result.playersUpdated,
        cancelled: result.playersCancelled,
        failed:    result.playersFailed,
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");

    // 失敗記録（PII 非含有: code か短い種別のみ）。
    const shortError =
      err instanceof Prisma.PrismaClientKnownRequestError ? `db_error:${err.code}` : "internal_error";

    if (idempotencyKey) {
      // reserve 済みの行を failed に更新（best-effort・二次失敗は握りつぶす）。
      try {
        await prisma.uzuProSyncRequest.update({
          where: { idempotencyKey },
          data: { status: "failed", error: shortError },
        });
      } catch {
        /* noop: 記録失敗は本エラー応答を妨げない */
      }
    }

    try {
      await recordUzuProActivity(prisma, {
        action: "sync_failure",
        targetType: "sync",
        detail: { error: shortError },
      });
    } catch {
      /* noop */
    }

    return serverError(err);
  }
}
