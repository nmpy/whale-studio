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
      // 対象作品の for UZU Pro 有効状態（実行時利用停止の判定）まで解決する。
      player: {
        select: {
          bookingId: true,
          booking: { select: { work: { select: { uzuProEnabled: true } } } },
        },
      },
      oa: { select: { liffId: true } },
    },
  });
  if (!link) return { kind: "not_found" };
  // 作品が for UZU Pro 無効 = 発行済み URL も実行時に利用停止（DB のリンクは失効させない）。
  // 関連データ欠損（booking / work が無い）も含め、存在推測させないため not_found に一般化する。
  //   → レスポンスから「作品が無効化されている事実」を特定できない（存在しない/失効/期限切れと同一化）。
  if (link.player?.booking?.work?.uzuProEnabled !== true) return { kind: "not_found" };
  if (link.revokedAt || link.status === "revoked") return { kind: "revoked" };
  if (link.status === "error") return { kind: "revoked" }; // 生成失敗リンクは利用不可（失効相当）
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return { kind: "expired" };
  // issued / linked かつ 作品有効 のみ利用可。
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
  | { kind: "conflict_booking_duplicate" }
  /// 書き込み直前の再検証で対象作品が for UZU Pro 無効だった（実行時利用停止）。
  | { kind: "work_disabled" };

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

    // 書き込み直前の再検証（TOCTOU 対策）: 対象作品行を FOR UPDATE でロックし、for UZU Pro
    // 有効状態を最新のコミット値で確認する。GET 時に有効でも、bind 送信までに管理者が無効化した
    // 場合は無効作品へ LINE User ID を保存しない（= 古い LIFF 画面からの遅延送信を排除）。
    //   FOR UPDATE により、無効化(work.update)と本 bind は works 行で直列化される。
    const bk = await tx.uzuProBooking.findFirst({
      where: { id: bookingId, oaId },
      select: { workId: true },
    });
    if (!bk) return { kind: "work_disabled" as const }; // 関連欠損も一般化して停止
    const [work] = await tx.$queryRaw<Array<{ uzu_pro_enabled: boolean }>>`
      SELECT uzu_pro_enabled FROM works WHERE id = ${bk.workId} FOR UPDATE`;
    if (!work || work.uzu_pro_enabled !== true) return { kind: "work_disabled" as const };

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

    // 条件付き更新（compare-and-set: lineUserId=null のときのみ）。連携元は LIFF。
    const upd = await tx.uzuProPlayer.updateMany({
      where: { id: playerId, lineUserId: null },
      data: { lineUserId, linkedAt: now, lineLinkSource: "LIFF" },
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

// ─────────────────────────── 手動登録 / 手動解除（LIFF 管理者・緊急運用） ───────────────────────────
// LIFF が利用できない緊急時に、管理画面から対象プレイヤーへ LINE User ID を直接登録/解除する。
// LIFF 経由(bindPlayerLineUser)と同じ整合性制約を維持する:
//   - Player→Booking→Work をサーバー側で解決（クライアント申告の workId/bookingId は信用しない）。
//   - 予約行 + 作品行を FOR UPDATE でロックし、Work.uzuProEnabled を書き込み直前に再検証（TOCTOU）。
//   - 冪等（同一 UID 再登録）/ 別 UID 競合 / 同一予約内重複 を LIFF と同一ルールで判定。
//   - 既存 UID の直接上書きはしない（別 UID へは「手動解除 → 手動登録」の 2 段階）。

export type ManualLinkResult =
  | { kind: "linked" }
  | { kind: "already_linked_same" }
  | { kind: "conflict_other_account" }
  | { kind: "conflict_booking_duplicate" }
  | { kind: "work_disabled" }
  | { kind: "player_not_found" };

/**
 * 管理画面からの LINE User ID 手動登録。playerId から関連(Booking/Work)を解決し、
 * LIFF bind と同じ並行制御・整合性で MANUAL 連携を保存する。lineUserId は route 側で形式検証済みの値。
 */
export async function manualLinkPlayerLineUser(args: {
  oaId: string;
  workId: string;
  playerId: string;
  lineUserId: string;
  now?: Date;
}): Promise<ManualLinkResult> {
  const { oaId, workId, playerId, lineUserId } = args;
  const now = args.now ?? new Date();

  // クライアント申告の workId/bookingId は信用せず、player から関連を解決する。
  const resolved = await prisma.uzuProPlayer.findFirst({
    where: { id: playerId, oaId, booking: { workId } },
    select: { id: true, bookingId: true },
  });
  if (!resolved) return { kind: "player_not_found" };
  const bookingId = resolved.bookingId;

  return prisma.$transaction(async (tx) => {
    // 予約行 + 作品行を直列化（LIFF bind と同じロック順序で並行安全）。
    await tx.$queryRaw`SELECT id FROM uzu_pro_bookings WHERE id = ${bookingId} FOR UPDATE`;
    const [work] = await tx.$queryRaw<Array<{ uzu_pro_enabled: boolean }>>`
      SELECT uzu_pro_enabled FROM works WHERE id = ${workId} FOR UPDATE`;
    if (!work || work.uzu_pro_enabled !== true) return { kind: "work_disabled" as const };

    // テナント境界 + 現在値（ロック後）。念のため booking→work 帰属も再確認。
    const player = await tx.uzuProPlayer.findFirst({
      where: { id: playerId, oaId, bookingId, booking: { workId } },
      select: { lineUserId: true },
    });
    if (!player) return { kind: "player_not_found" as const };

    // 冪等: 同一プレイヤー・同一 UID（値は変えない。source は既存を尊重し上書きしない）。
    if (player.lineUserId === lineUserId) return { kind: "already_linked_same" as const };
    // 上書き禁止: 別 UID が既に紐づいている（解除→登録の 2 段階を要求）。
    if (player.lineUserId && player.lineUserId !== lineUserId) return { kind: "conflict_other_account" as const };

    // 同一予約内で同じ UID が別プレイヤーに紐づいていないか（ロック下で確認）。
    const dup = await tx.uzuProPlayer.findFirst({
      where: { bookingId, lineUserId, id: { not: playerId } },
      select: { id: true },
    });
    if (dup) return { kind: "conflict_booking_duplicate" as const };

    // 条件付き更新（compare-and-set: lineUserId=null のときのみ）。連携元は MANUAL。
    const upd = await tx.uzuProPlayer.updateMany({
      where: { id: playerId, lineUserId: null },
      data: { lineUserId, linkedAt: now, lineLinkSource: "MANUAL" },
    });
    if (upd.count !== 1) {
      const p2 = await tx.uzuProPlayer.findFirst({ where: { id: playerId, oaId }, select: { lineUserId: true } });
      if (p2?.lineUserId === lineUserId) return { kind: "already_linked_same" as const };
      return { kind: "conflict_other_account" as const };
    }
    return { kind: "linked" as const };
  });
}

export type ManualUnlinkResult =
  | { kind: "unlinked" }
  | { kind: "already_unlinked" }
  | { kind: "player_not_found" };

/**
 * 管理画面からの LINE User ID 手動解除。LINE User ID のみ解除し、LIFF URL 自体は
 * 自動再発行・自動失効させない（URL・tokenHash は不変）。ただし表示整合のため、当該プレイヤーの
 * status="linked" の LIFF リンクは "issued"（発行済み・URL は有効なまま）へ戻す（revoke ではない）。
 */
export async function manualUnlinkPlayerLineUser(args: {
  oaId: string;
  workId: string;
  playerId: string;
}): Promise<ManualUnlinkResult> {
  const { oaId, workId, playerId } = args;

  const resolved = await prisma.uzuProPlayer.findFirst({
    where: { id: playerId, oaId, booking: { workId } },
    select: { id: true, bookingId: true },
  });
  if (!resolved) return { kind: "player_not_found" };
  const bookingId = resolved.bookingId;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM uzu_pro_bookings WHERE id = ${bookingId} FOR UPDATE`;

    const player = await tx.uzuProPlayer.findFirst({
      where: { id: playerId, oaId, bookingId },
      select: { lineUserId: true },
    });
    if (!player) return { kind: "player_not_found" as const };
    // 冪等: 既に未連携なら何もしない。
    if (!player.lineUserId) return { kind: "already_unlinked" as const };

    // LINE 連携のみ解除（LIFF URL は失効/再発行しない）。
    await tx.uzuProPlayer.updateMany({
      where: { id: playerId, oaId },
      data: { lineUserId: null, linkedAt: null, lineLinkSource: null },
    });
    // 表示整合: linked リンクを issued へ戻す（URL は有効なまま = 再連携可能）。revoke はしない。
    await tx.uzuProLiffLink.updateMany({
      where: { playerId, oaId, status: "linked" },
      data: { status: "issued", linkedAt: null },
    });
    return { kind: "unlinked" as const };
  });
}
