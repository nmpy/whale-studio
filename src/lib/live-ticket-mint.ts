// src/lib/live-ticket-mint.ts
//
// 匿名連携（ウズプロCMS → Whale Studio）用のチケットリンク発行サービス（トークン発行の正本）。
//   - 匿名予約枠（LiveTeam）を externalBookingRef で冪等 upsert し、
//     LiveTicketLinkToken を LiveSession / LiveTeam へ直接結び付けて発行する。
//   - 個人情報（氏名・メール・ESCAPE.ID チケットID・購入日時・チケット種別 等）は一切保存しない。
//   - 平文トークンは DB へ保存しない（tokenHash=sha256 のみ）。平文 URL は発行レスポンスに一度だけ載る。
//   - 外部 API route と将来の管理画面から同じ関数を呼べる（route 間 HTTP はしない）。
//
// 既存トークン基盤（live-ticket-link.ts）の generate/hash/expiry/URL を流用し、二重化しない。
// 外部契約の語彙は必ず externalBookingRef。schema 互換のため token.reservationNumber = externalBookingRef を保存する。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateTicketToken, hashTicketToken, buildTicketLiffUrl } from "@/lib/live-ticket-link";
import { UZU_PRO_ORIGIN } from "@/lib/live-origin";

type Db = Prisma.TransactionClient | typeof prisma;

/** 初期対応で許可する定員。正本は capacity（groupType だけに依存しない）。 */
export const ALLOWED_CAPACITIES = [2, 4] as const;
export type AllowedCapacity = (typeof ALLOWED_CAPACITIES)[number];

export function isAllowedCapacity(n: number): n is AllowedCapacity {
  return (ALLOWED_CAPACITIES as readonly number[]).includes(n);
}

/** capacity → groupType 互換（2→"two" / 4→"four"）。表示用の補助であり正本ではない。 */
export function capacityToGroupType(capacity: number): "two" | "four" | null {
  if (capacity === 2) return "two";
  if (capacity === 4) return "four";
  return null;
}

/** 匿名予約枠の表示名（個人情報を含めない・externalBookingRef ベース）。 */
export function deriveAnonymousTeamName(externalBookingRef: string): string {
  return `予約枠 ${externalBookingRef}`;
}

/**
 * 匿名予約枠 LiveTeam を冪等 upsert する。
 * キー = (liveSessionId, externalBookingRef)（複合 unique・原子的）。
 * 個人情報（purchaserName / ticketId / reservationNumber / memo）は保存しない。
 */
export async function upsertAnonymousTeam(
  db: Db,
  args: { oaId: string; liveSessionId: string; externalBookingRef: string; capacity: AllowedCapacity },
): Promise<{ id: string }> {
  const groupType = capacityToGroupType(args.capacity);
  const team = await db.liveTeam.upsert({
    where: {
      liveSessionId_externalBookingRef: {
        liveSessionId: args.liveSessionId,
        externalBookingRef: args.externalBookingRef,
      },
    },
    update: { capacity: args.capacity, groupType },
    create: {
      oaId: args.oaId,
      liveSessionId: args.liveSessionId,
      origin: UZU_PRO_ORIGIN, // 親 UZU_PRO Session 配下の匿名 team（origin 継承）
      externalBookingRef: args.externalBookingRef,
      capacity: args.capacity,
      groupType,
      name: deriveAnonymousTeamName(args.externalBookingRef),
      // 個人情報は保存しない: reservationNumber / ticketId / purchaserName / memo は未設定（null）。
    },
    select: { id: true, origin: true },
  });
  // 不変条件: native team は externalBookingRef を設定しない → 非 null ref の upsert は UZU_PRO のみに一致。
  if (team.origin !== UZU_PRO_ORIGIN) {
    throw new Error(`[live-ticket-mint] origin boundary violation: matched non-UZU_PRO team for externalBookingRef`);
  }
  return { id: team.id };
}

/**
 * 同一の匿名予約枠に紐づく既存トークンを revoke する（履歴は破壊しない = revokedAt:null のみ更新）。
 *   - includeExpired=false（既定・mint 時）: 未失効かつ期限内のトークンのみ revoke。
 *   - includeExpired=true（明示 revoke API）: 未失効トークンをすべて revoke（期限切れ含む・冪等）。
 * external refs で対象を限定するため、legacy トークン（external refs=null）には影響しない。
 * @returns revoke した件数
 */
export async function revokeAnonymousBookingTokens(
  db: Db,
  args: {
    oaId: string;
    workId: string;
    externalSessionRef: string;
    externalBookingRef: string;
    now?: Date;
    includeExpired?: boolean;
  },
): Promise<number> {
  const now = args.now ?? new Date();
  const where: Prisma.LiveTicketLinkTokenWhereInput = {
    oaId: args.oaId,
    workId: args.workId,
    origin: UZU_PRO_ORIGIN, // external v2 は UZU_PRO のみ（NATIVE token を失効できない）
    externalSessionRef: args.externalSessionRef,
    externalBookingRef: args.externalBookingRef,
    revokedAt: null,
  };
  if (!args.includeExpired) where.expiresAt = { gt: now };
  const r = await db.liveTicketLinkToken.updateMany({ where, data: { revokedAt: now } });
  return r.count;
}

/**
 * 匿名チケットリンクトークンを発行する。
 *   - liveSessionId / teamId を直接保存（resolve は reservationNumber 照合より優先）。
 *   - schema 互換のため reservationNumber = externalBookingRef を保存（外部契約では公開しない）。
 *   - 平文トークンは保存しない（tokenHash のみ）。URL は戻り値に一度だけ載る。
 */
export async function issueAnonymousTicketToken(
  db: Db,
  args: {
    oaId: string;
    workId: string;
    externalSessionRef: string;
    externalBookingRef: string;
    liveSessionId: string;
    teamId: string;
    liffId: string;
    expiresAt: Date;
  },
): Promise<{ url: string; tokenRecordId: string }> {
  const token = generateTicketToken();
  const tokenHash = hashTicketToken(token);
  const rec = await db.liveTicketLinkToken.create({
    data: {
      oaId: args.oaId,
      workId: args.workId,
      origin: UZU_PRO_ORIGIN, // 発行元 UZU_PRO（親 Session/Team の origin を継承）
      reservationNumber: args.externalBookingRef, // schema 互換マップ（外部契約では非公開）
      ticketId: null,
      externalSessionRef: args.externalSessionRef,
      externalBookingRef: args.externalBookingRef,
      liveSessionId: args.liveSessionId,
      teamId: args.teamId,
      tokenHash,
      expiresAt: args.expiresAt,
    },
    select: { id: true },
  });
  return { url: buildTicketLiffUrl(args.liffId, token), tokenRecordId: rec.id };
}

export interface MintAnonymousTicketLinkArgs {
  oaId: string;
  workId: string;
  externalSessionRef: string;
  externalBookingRef: string;
  liveSessionId: string;
  capacity: AllowedCapacity;
  liffId: string;
  expiresAt: Date;
  now?: Date;
}

/**
 * 匿名予約枠の発行フロー（team upsert → 旧トークン revoke → 新トークン発行）を 1 まとめで行う。
 * 呼び出し側（route）は 1 トランザクション内で LiveSession を解決済みにしてから渡すこと。
 * 「同一予約枠は常に最新 1 件だけ有効」を保証する（再送安全）。
 */
export async function mintAnonymousTicketLink(
  db: Db,
  args: MintAnonymousTicketLinkArgs,
): Promise<{ url: string; tokenRecordId: string; teamId: string; expiresAt: Date }> {
  const team = await upsertAnonymousTeam(db, {
    oaId: args.oaId,
    liveSessionId: args.liveSessionId,
    externalBookingRef: args.externalBookingRef,
    capacity: args.capacity,
  });
  await revokeAnonymousBookingTokens(db, {
    oaId: args.oaId,
    workId: args.workId,
    externalSessionRef: args.externalSessionRef,
    externalBookingRef: args.externalBookingRef,
    now: args.now,
    includeExpired: false,
  });
  const minted = await issueAnonymousTicketToken(db, {
    oaId: args.oaId,
    workId: args.workId,
    externalSessionRef: args.externalSessionRef,
    externalBookingRef: args.externalBookingRef,
    liveSessionId: args.liveSessionId,
    teamId: team.id,
    liffId: args.liffId,
    expiresAt: args.expiresAt,
  });
  return { url: minted.url, tokenRecordId: minted.tokenRecordId, teamId: team.id, expiresAt: args.expiresAt };
}
