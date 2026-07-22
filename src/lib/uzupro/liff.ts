// src/lib/uzupro/liff.ts
// for ウズプロ: プレイヤー単位の LIFF リンク発行サービス（発行の正本）。
//
// 保証（spec §7）:
//   - プレイヤーごとに推測不可能なランダムトークン（crypto.randomBytes32 base64url, 256bit）。
//   - tokenHash(sha256 hex) のみ保存。平文は DB に保存せず、発行レスポンス URL に一度だけ載る。
//   - 1 プレイヤー 1 有効(issued)リンク: 対象 player 行を FOR UPDATE ロック → 旧 issued を revoke → 新規発行。
//     さらに DB の部分 UNIQUE INDEX (uzu_pro_liff_links_one_active_per_player, WHERE status='issued') で
//     並行実行でも二重発行を構造的に防ぐ。
//   - キャンセル済みプレイヤー(status=cancelled)は発行対象外。
//   - 未発行のみ発行 / 発行済みは通常操作で上書きしない / 再発行は旧 URL を失効。
//   - URL に予約番号/チケットID/連番/個人情報を載せない（ランダムトークンのみ）。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateTicketToken, hashTicketToken } from "@/lib/live-ticket-link";

type Db = Prisma.TransactionClient | typeof prisma;

/** for ウズプロ用の LIFF URL（#591 の /ticket 経路とは別。ルートに ?t=）。PR2 で /api/liff/uzu-pro/link が消費。 */
export function buildUzuProLiffUrl(liffId: string, token: string): string {
  return `https://liff.line.me/${liffId}?t=${token}`;
}

export type IssueLiffResult =
  /** 新規発行（or 再発行）した。url は平文で一度だけ返る。 */
  | { kind: "issued"; url: string; linkId: string }
  /** 既に有効な issued リンクがあり、reissue でないため据え置き。 */
  | { kind: "already_issued"; linkId: string }
  /** キャンセル済みプレイヤーのため対象外。 */
  | { kind: "skipped_cancelled" }
  /** プレイヤーが対象 OA に存在しない（別作品/別OAの誤操作含む）。 */
  | { kind: "not_found" };

/**
 * 対象プレイヤーへ LIFF リンクを発行する。**呼び出し側で prisma.$transaction を張ること**。
 *   - reissue=false: 未発行のみ発行。既に issued があれば据え置き（already_issued）。
 *   - reissue=true : 旧 issued を revoke してから新規発行（失効して再発行）。
 * 対象 player 行を FOR UPDATE でロックし、同一プレイヤーへの並行発行を直列化する。
 * oaId 条件を必ず含め、他 OA/他作品のプレイヤーは操作できない（not_found）。
 */
export async function issueLiffForPlayer(
  tx: Prisma.TransactionClient,
  args: {
    oaId: string;
    playerId: string;
    liffId: string;
    expiresAt: Date | null;
    now: Date;
    reissue?: boolean;
  },
): Promise<IssueLiffResult> {
  const { oaId, playerId, liffId, expiresAt, now, reissue = false } = args;

  // 1. 対象 player 行をロック（同一プレイヤーの同時発行を直列化）。
  await tx.$queryRaw`SELECT id FROM uzu_pro_players WHERE id = ${playerId} FOR UPDATE`;

  // 2. テナント境界 + 状態確認（他 OA のプレイヤーは操作不可）。
  const player = await tx.uzuProPlayer.findFirst({
    where: { id: playerId, oaId },
    select: { id: true, status: true },
  });
  if (!player) return { kind: "not_found" };
  if (player.status === "cancelled") return { kind: "skipped_cancelled" };

  // 3. 既存の有効(issued)リンクを確認。
  const active = await tx.uzuProLiffLink.findFirst({
    where: { playerId, status: "issued" },
    select: { id: true },
  });
  if (active && !reissue) {
    return { kind: "already_issued", linkId: active.id };
  }
  if (active && reissue) {
    // 旧 URL を失効（履歴は残す）。partial-unique を空けてから新規発行する。
    await tx.uzuProLiffLink.update({
      where: { id: active.id },
      data: { status: "revoked", revokedAt: now },
    });
  }

  // 4. 新規トークン発行（平文は保存しない）。
  const token = generateTicketToken();
  const tokenHash = hashTicketToken(token);
  const created = await tx.uzuProLiffLink.create({
    data: {
      oaId,
      playerId,
      tokenHash,
      status: "issued",
      expiresAt,
      issuedAt: now,
    },
    select: { id: true },
  });

  return { kind: "issued", url: buildUzuProLiffUrl(liffId, token), linkId: created.id };
}

/**
 * 対象プレイヤーの有効(issued)リンクを失効する（再発行を伴わない単独失効）。
 * 呼び出し側で $transaction を張ること。冪等（有効リンクが無ければ 0 件）。
 * @returns 失効した件数
 */
export async function revokeLiffForPlayer(
  tx: Prisma.TransactionClient,
  args: { oaId: string; playerId: string; now: Date },
): Promise<number> {
  const { oaId, playerId, now } = args;
  await tx.$queryRaw`SELECT id FROM uzu_pro_players WHERE id = ${playerId} FOR UPDATE`;
  const player = await tx.uzuProPlayer.findFirst({
    where: { id: playerId, oaId },
    select: { id: true },
  });
  if (!player) return 0;
  const r = await tx.uzuProLiffLink.updateMany({
    where: { playerId, status: "issued" },
    data: { status: "revoked", revokedAt: now },
  });
  return r.count;
}
