// src/lib/live-ticket-mint.ts
//
// LiveTicketLinkToken の「発行(mint)」「失効(revoke)」の唯一の正本（server-side service）。
//   - 外部 mint API（/api/external/v1/live/ticket-links）
//   - ESCAPE.ID 取込（/api/oas/[id]/live/ticket-import）
//   - （将来の）再発行 API
//   これらはすべて **route 間 HTTP 通信ではなく本モジュールの関数を直接呼ぶ**（正本を1つに集約）。
//
// 平文 token は生成時のみ URL に載せ、DB には tokenHash(sha256) のみ保存する（平文は復元不可）。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateTicketToken, hashTicketToken, buildTicketLiffUrl } from "@/lib/live-ticket-link";

/** prisma / interactive tx どちらでも受けられる最小型。 */
type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 対象 (oaId, workId, reservationNumber) の **未失効・期限内**トークンを失効させる。失効件数を返す。
 * 再送/再発行時に「有効な URL を1本に保つ」ために使う。
 */
export async function revokePriorValidTicketTokens(
  db: Db,
  args: { oaId: string; workId: string; reservationNumber: string; now?: Date },
): Promise<number> {
  const now = args.now ?? new Date();
  const r = await db.liveTicketLinkToken.updateMany({
    where: { oaId: args.oaId, workId: args.workId, reservationNumber: args.reservationNumber, revokedAt: null, expiresAt: { gt: now } },
    data:  { revokedAt: now },
  });
  return r.count;
}

/**
 * トークンを1件発行して LIFF URL を返す（tokenHash のみ保存）。
 * revoke はしない（呼び出し側で必要なら revokePriorValidTicketTokens を先に呼ぶ）。
 * 戻り値の url にのみ平文 token が載る（DB 非保存・ログ非出力）。
 */
export async function issueTicketLinkToken(
  db: Db,
  args: {
    oaId: string; workId: string; reservationNumber: string; ticketId?: string | null;
    liffId: string; expiresAt: Date; liveSessionId?: string | null; teamId?: string | null;
  },
): Promise<{ url: string; tokenRecordId: string }> {
  const token = generateTicketToken();
  const tokenHash = hashTicketToken(token);
  const rec = await db.liveTicketLinkToken.create({
    data: {
      oaId:              args.oaId,
      workId:            args.workId,
      reservationNumber: args.reservationNumber,
      ticketId:          args.ticketId ?? null,
      tokenHash,
      expiresAt:         args.expiresAt,
      liveSessionId:     args.liveSessionId ?? null,
      teamId:            args.teamId ?? null,
    },
    select: { id: true },
  });
  return { url: buildTicketLiffUrl(args.liffId, token), tokenRecordId: rec.id };
}
