// src/lib/uzupro/status-view.ts
// for UZU Pro「連携状況」ダッシュボードの読み取り専用 view-model（集計）。
//
// 方針（Phase 1）:
//   - すべて read-only。origin=UZU_PRO を明示。oaId と workId の **両方** でスコープする。
//   - 件数は DB 側 count / aggregate / groupBy で取得（全件取得して JS 集計しない）。並列化は Promise.all。
//   - PII（氏名/メール/購入情報/LINE UID）・内部DB主キーは view-model に一切含めない。
//   - 業務向けダッシュボード = player-unit（#592: UzuProBooking / UzuProPlayer / UzuProLiffLink）
//     + LiveSession(origin=UZU_PRO) を正本とする。
//     #591 の team-unit（LiveTicketLinkToken / LiveParticipant / LiveTeam）は Phase 1 の集計対象外（別系統）。
//     player-unit と team-unit の件数は合算・混同しない。
//
// 指標定義（view-model / テストで固定）:
//   - sessions:            LiveSession の (oaId, workId, origin=UZU_PRO) 件数。NATIVE は除外。
//   - liff:                UzuProLiffLink を対象作品で既存 status enum 別に集計（issued/revoked/linked/error）+ total。
//   - players:             UzuProPlayer を対象作品で active / cancelled 別に集計 + total。
//   - lastBookingSyncedAt: 対象作品内 UzuProBooking.syncedAt の最大値（=「最終予約同期」。他指標と混ぜない）。
//   - errors:              { syncRequests: UzuProSyncRequest(status=failed), liffLinks: UzuProLiffLink(status=error), total }
//                          （二重計上を避けるため内訳を保持し、単純合算した total も併記）。
//   - cmsUrl:              env UZU_PRO_CMS_BASE_URL（任意）。未設定/空/不正 URL は null（エラーにしない・ハードコードしない）。

import { prisma } from "@/lib/prisma";
import { UZU_PRO_ORIGIN } from "@/lib/live-origin";
import { UzuProLiffStatus, UzuProPlayerStatus, UzuProSyncStatus } from "@prisma/client";

export interface UzuProStatusView {
  /** LiveSession(oaId, workId, origin=UZU_PRO) 件数 */
  sessions: number;
  /** UzuProLiffLink の status 別内訳（対象作品スコープ） */
  liff: { issued: number; revoked: number; linked: number; error: number; total: number };
  /** UzuProPlayer の active / cancelled（対象作品スコープ） */
  players: { active: number; cancelled: number; total: number };
  /** 最終予約同期（UzuProBooking.syncedAt の最大値。未同期なら null） */
  lastBookingSyncedAt: Date | null;
  /** 要確認エラーの内訳（二重計上回避のため内訳を保持） */
  errors: { syncRequests: number; liffLinks: number; total: number };
  /** UZU Pro CMS 外部リンク（env 未設定なら null = ボタン非表示） */
  cmsUrl: string | null;
}

/**
 * env UZU_PRO_CMS_BASE_URL を解決する。未設定/空/不正 URL は null（例外にしない・URL をハードコードしない）。
 * 内部DB主キーや個人情報を付与しないよう、base URL をそのまま（正規化のみ）返す。
 */
export function resolveUzuProCmsUrl(): string | null {
  const raw = (process.env.UZU_PRO_CMS_BASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * 連携状況の集計 view-model を返す。read-only・DB 集計・PII/内部ID 非含有。
 * oaId と workId の両方でスコープするため、URL の workId 差し替えで他作品データは参照できない。
 */
export async function getUzuProStatusView(args: { oaId: string; workId: string }): Promise<UzuProStatusView> {
  const { oaId, workId } = args;

  const [sessions, liffGroups, playerGroups, bookingAgg, failedSyncRequests, errorLiffLinks] = await Promise.all([
    // セッション: origin=UZU_PRO のみ（NATIVE 除外）・oaId + workId。
    prisma.liveSession.count({ where: { oaId, workId, origin: UZU_PRO_ORIGIN } }),
    // LIFF: status 別（DB 集計）。対象作品 = player→booking の oaId + workId。
    prisma.uzuProLiffLink.groupBy({
      by: ["status"],
      where: { oaId, player: { booking: { oaId, workId } } },
      _count: true,
    }),
    // プレイヤー: status 別（DB 集計）。対象作品 = booking の oaId + workId。
    prisma.uzuProPlayer.groupBy({
      by: ["status"],
      where: { oaId, booking: { oaId, workId } },
      _count: true,
    }),
    // 最終予約同期: 対象作品の UzuProBooking.syncedAt の最大値。
    prisma.uzuProBooking.aggregate({ where: { oaId, workId }, _max: { syncedAt: true } }),
    // エラー内訳①: 失敗した同期リクエスト。
    prisma.uzuProSyncRequest.count({ where: { oaId, workId, status: UzuProSyncStatus.failed } }),
    // エラー内訳②: error 状態の LIFF リンク。
    prisma.uzuProLiffLink.count({ where: { oaId, player: { booking: { oaId, workId } }, status: UzuProLiffStatus.error } }),
  ]);

  const liffBy = (s: UzuProLiffStatus) => liffGroups.find((g) => g.status === s)?._count ?? 0;
  const playerBy = (s: UzuProPlayerStatus) => playerGroups.find((g) => g.status === s)?._count ?? 0;

  const liff = {
    issued: liffBy(UzuProLiffStatus.issued),
    revoked: liffBy(UzuProLiffStatus.revoked),
    linked: liffBy(UzuProLiffStatus.linked),
    error: liffBy(UzuProLiffStatus.error),
    total: 0,
  };
  liff.total = liff.issued + liff.revoked + liff.linked + liff.error;

  const players = {
    active: playerBy(UzuProPlayerStatus.active),
    cancelled: playerBy(UzuProPlayerStatus.cancelled),
    total: 0,
  };
  players.total = players.active + players.cancelled;

  return {
    sessions,
    liff,
    players,
    lastBookingSyncedAt: bookingAgg._max.syncedAt ?? null,
    errors: {
      syncRequests: failedSyncRequests,
      liffLinks: errorLiffLinks,
      total: failedSyncRequests + errorLiffLinks,
    },
    cmsUrl: resolveUzuProCmsUrl(),
  };
}
