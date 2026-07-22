// src/lib/uzupro/line-link.ts
// for UZU Pro: プレイヤー専用 LIFF リンク（公開コード）→ 対象プレイヤーへ LINE User ID を紐づけるサービス。
//
// 前提:
//   - 公開コード(publicCode) = 発行時の平文トークン。DB は tokenHash(sha256) のみ保持。
//   - LINE User ID は「各プレイヤー」に保存（予約/チケット単位ではない）。
//   - 予約 1 件に複数プレイヤー（可変人数・上限固定しない）。
//   - LINE User ID はグローバル unique にしない（別予約・別公演で同一人物が参加し得る）。
//     重複禁止スコープは「同一予約(bookingId)内」に限定する。
//
// 並行制御:
//   - 単純な「SELECT → UPDATE」では二重紐づけを防げない。予約行を FOR UPDATE でロックして
//     同一予約内の bind を直列化し、その中で「現在値確認 → 同一予約内重複チェック → 条件付き更新」を行う。
//   - 条件付き更新は updateMany(where lineUserId=null) の compare-and-set（後勝ち上書きを防ぐ）。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashTicketToken } from "@/lib/live-ticket-link";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";

type Db = Prisma.TransactionClient | typeof prisma;

export type ResolvePlayerLinkResult =
  | { kind: "ok"; linkId: string; playerId: string; bookingId: string; oaId: string; liffId: string | null }
  | { kind: "not_found" }
  | { kind: "revoked" }
  | { kind: "expired" };

/**
 * 公開コード(平文トークン)から対象プレイヤーリンクを解決する（サーバー側解決・クライアント申告 ID を使わない）。
 * 存在しない/失効/期限切れを区別して返す（UI では一般化した文言にまとめる）。
 */
export async function resolveUzuProPlayerLink(
  db: Db,
  publicCode: string,
  now: Date = new Date(),
): Promise<ResolvePlayerLinkResult> {
  const tokenHash = hashTicketToken(publicCode);
  const link = await db.uzuProLiffLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      playerId: true,
      oaId: true,
      status: true,
      expiresAt: true,
      revokedAt: true,
      player: { select: { bookingId: true } },
      oa: { select: { liffId: true } },
    },
  });
  if (!link) return { kind: "not_found" };
  if (link.revokedAt || link.status === "revoked") return { kind: "revoked" };
  if (link.status === "error") return { kind: "revoked" }; // 生成失敗リンクは利用不可（失効相当）
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return { kind: "expired" };
  // issued / linked のみ利用可。
  return {
    kind: "ok",
    linkId: link.id,
    playerId: link.playerId,
    bookingId: link.player.bookingId,
    oaId: link.oaId,
    liffId: getLiffIdForUrlGeneration({ liffId: link.oa?.liffId ?? null }),
  };
}

export type BindPlayerLineResult =
  | { kind: "linked" }
  | { kind: "already_linked_same" }
  | { kind: "conflict_other_account" }
  | { kind: "conflict_booking_duplicate" };

/**
 * 対象プレイヤーへ LINE User ID を紐づける。予約行を FOR UPDATE で直列化して並行安全に処理する。
 * 呼び出し側では既に resolve 済み（linkId/playerId/bookingId）を渡すこと。lineUserId は検証済み sub。
 */
export async function bindPlayerLineUser(args: {
  linkId: string;
  playerId: string;
  bookingId: string;
  oaId: string;
  lineUserId: string;
  now?: Date;
}): Promise<BindPlayerLineResult> {
  const { linkId, playerId, bookingId, oaId, lineUserId } = args;
  const now = args.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    // 予約単位で直列化（同一予約内の並行 bind を排他）。別予約は競合しない。
    await tx.$queryRaw`SELECT id FROM uzu_pro_bookings WHERE id = ${bookingId} FOR UPDATE`;

    // テナント境界 + 現在値（ロック後に読む）。
    const player = await tx.uzuProPlayer.findFirst({
      where: { id: playerId, oaId },
      select: { lineUserId: true },
    });
    if (!player) return { kind: "conflict_other_account" as const }; // 解決済みだが念のため（存在しない=不整合）

    // 冪等: 同一プレイヤー・同一 LINE User ID。
    if (player.lineUserId === lineUserId) {
      await tx.uzuProLiffLink.update({
        where: { id: linkId },
        data: { status: "linked", linkedAt: now, openedAt: now },
      });
      return { kind: "already_linked_same" as const };
    }
    // 上書き禁止: 別 LINE User ID が既に紐づいている。
    if (player.lineUserId && player.lineUserId !== lineUserId) {
      return { kind: "conflict_other_account" as const };
    }

    // 同一予約内で同じ LINE User ID が別プレイヤーに紐づいていないか（ロック下で安全に確認）。
    const dup = await tx.uzuProPlayer.findFirst({
      where: { bookingId, lineUserId, id: { not: playerId } },
      select: { id: true },
    });
    if (dup) return { kind: "conflict_booking_duplicate" as const };

    // 条件付き更新（compare-and-set: lineUserId=null のときのみ）。
    const upd = await tx.uzuProPlayer.updateMany({
      where: { id: playerId, lineUserId: null },
      data: { lineUserId, linkedAt: now },
    });
    if (upd.count !== 1) {
      // ロック下では通常起きないが、防御的に再判定。
      const p2 = await tx.uzuProPlayer.findFirst({ where: { id: playerId, oaId }, select: { lineUserId: true } });
      if (p2?.lineUserId === lineUserId) return { kind: "already_linked_same" as const };
      return { kind: "conflict_other_account" as const };
    }

    await tx.uzuProLiffLink.update({
      where: { id: linkId },
      data: { status: "linked", linkedAt: now, openedAt: now },
    });
    return { kind: "linked" as const };
  });
}
