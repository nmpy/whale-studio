// src/lib/uzupro/ticket-link-view.ts
//
// for ウズプロ ＞ チケット連携（管理・**read-only**）の View Model 組み立て。
//
// 位置づけ:
//   - LIFF から登録された TicketLink の **実データ**を運営が確認するための画面用。
//     LIFF 管理タブ（Work.liffHomeSettingsJson の ticket_link）は「設定」であり別責務。
//   - **書き込みは一切行わない。** status 変更・承認・解除・削除の口をここに作らない
//     （「運営確認待ち」の解除は UZU Pro CMS の pull → sync-result が担う既存設計）。
//   - oaId + workId で必ずスコープする。呼び出し側で work が対象 OA に属することを検証済みであること。
//
// 予約番号の扱い:
//   この画面は ESCAPE.ID / UZU Pro CMS / Whale Studio 間の照合キーとして
//   **フル値を表示する**（マスクすると運営が予約を特定できない）。
//   プレイヤー向け API（/api/liff/.../ticket-link/config）は従来どおり
//   maskReservationNumber のままで、こちらには一切影響させない。
//   ログ・URL クエリ・エラーメッセージに予約番号を出さないこと。

import { prisma } from "@/lib/prisma";
import type { TicketLinkStatus } from "@prisma/client";
import { normalizeReservationNumber } from "@/lib/ticket-link/reservation-number";
import {
  TICKET_LINK_STATUSES,
  TICKET_LINK_STATUS_LABEL,
  TICKET_LINK_PAGE_SIZE,
  type TicketLinkAdminFilters,
} from "./ticket-link-status";

// status 定数・ラベル・フィルタ型／parse は Client Component からも使うため
// prisma 非依存の ./ticket-link-status に置き、ここからは再 export するだけにする。
export {
  TICKET_LINK_STATUSES,
  TICKET_LINK_STATUS_LABEL,
  TICKET_LINK_PAGE_SIZE,
  parseTicketLinkFilters,
} from "./ticket-link-status";
export type { TicketLinkAdminFilters } from "./ticket-link-status";

export interface TicketLinkAdminRow {
  /** 行の React key 用。業務表示はしない。 */
  id: string;
  status: TicketLinkStatus;
  statusLabel: string;
  /** 確定時のチケット種別表示名スナップショット。 */
  ticketType: string | null;
  /** 確定時のチケット種別キー。修正ダイアログの初期選択に使う（PII ではない）。 */
  ticketTypeKey: string | null;
  participantCount: number;
  /** **フル値**（この画面は照合キーとして必要）。 */
  reservationNumber: string;
  /** 正規化キー。raw と同じなら UI 側で重複表示しない。 */
  normalizedReservationNumber: string;
  /** プレイヤーが入力した原文。normalized と異なるときだけ意味を持つ。 */
  reservationNumberRaw: string | null;
  /** 表記ゆれがあった（原文と正規形が異なる）か。 */
  reservationNumberDiffers: boolean;
  /** memberIndex 昇順。participantCount 分あるとは限らない（欠損はそのまま見せる）。 */
  codeNames: string[];
  source: string;
  confirmedAt: string;
  createdAt: string;
  updatedAt: string;
  uzuSyncedAt: string | null;
}

export interface TicketLinkAdminView {
  workTitle: string | null;
  rows: TicketLinkAdminRow[];
  /** 現在のフィルタ条件での総件数。 */
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  /** フィルタ非適用の全件（status 別）。バッジ表示用。 */
  statusCounts: Record<TicketLinkStatus, number>;
}

/**
 * 予約番号の検索条件を組み立てる。
 *
 * **正規化は既存の normalizeReservationNumber を再利用する**（検索専用の別実装を作らない）。
 * 完全な正規形へ解決できた場合は normalized の完全一致で引く
 * （`１２３４５６` / `123 456` / `123-456` がすべて同じ結果になる）。
 * 解決できない部分入力（例 `123`）は前方一致的な contains で拾う。
 */
export function buildReservationNumberWhere(input: string): {
  normalizedReservationNumber?: string | { contains: string };
} {
  const normalized = normalizeReservationNumber(input);
  if (normalized) return { normalizedReservationNumber: normalized };
  // 部分入力: 数字とハイフンだけ残して contains（NFKC で全角も吸収）。
  const loose = input.normalize("NFKC").replace(/[^\d-]/g, "");
  if (loose.length === 0) return {};
  return { normalizedReservationNumber: { contains: loose } };
}

/**
 * 一覧の View Model を組み立てる（**read-only**）。
 * oaId + workId でスコープするため、別 OA / 別作品の行は原理的に返らない。
 */
export async function getTicketLinkAdminView({
  oaId,
  workId,
  filters,
}: {
  oaId: string;
  workId: string;
  filters: TicketLinkAdminFilters;
}): Promise<TicketLinkAdminView> {
  const scope = { oaId, workId };

  const where: Record<string, unknown> = { ...scope };
  if (filters.status) where.status = filters.status;
  if (filters.reservationNumber) {
    Object.assign(where, buildReservationNumberWhere(filters.reservationNumber));
  }
  if (filters.codeName) {
    where.members = { some: { codeName: { contains: filters.codeName, mode: "insensitive" } } };
  }
  if (filters.ticketType) {
    where.ticketType = { contains: filters.ticketType, mode: "insensitive" };
  }

  const page = Math.max(1, filters.page);
  const skip = (page - 1) * TICKET_LINK_PAGE_SIZE;

  const [work, total, rows, grouped] = await Promise.all([
    prisma.work.findFirst({ where: { id: workId }, select: { title: true } }),
    prisma.ticketLink.count({ where }),
    prisma.ticketLink.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: TICKET_LINK_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        ticketType: true,
        ticketTypeKey: true,
        participantCount: true,
        normalizedReservationNumber: true,
        reservationNumberRaw: true,
        source: true,
        confirmedAt: true,
        createdAt: true,
        updatedAt: true,
        uzuSyncedAt: true,
        members: { orderBy: { memberIndex: "asc" }, select: { codeName: true } },
        // lineUserId / lineDisplayName は業務上不要なため **選択しない**（Client へ渡さない）。
      },
    }),
    prisma.ticketLink.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
  ]);

  const statusCounts = TICKET_LINK_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: grouped.find((g) => g.status === s)?._count._all ?? 0 }),
    {} as Record<TicketLinkStatus, number>,
  );

  return {
    workTitle: work?.title ?? null,
    total,
    page,
    pageSize: TICKET_LINK_PAGE_SIZE,
    pages: Math.max(1, Math.ceil(total / TICKET_LINK_PAGE_SIZE)),
    statusCounts,
    rows: rows.map((r) => {
      const raw = r.reservationNumberRaw;
      return {
        id: r.id,
        status: r.status,
        statusLabel: TICKET_LINK_STATUS_LABEL[r.status],
        ticketType: r.ticketType,
        ticketTypeKey: r.ticketTypeKey,
        participantCount: r.participantCount,
        reservationNumber: r.normalizedReservationNumber,
        normalizedReservationNumber: r.normalizedReservationNumber,
        reservationNumberRaw: raw,
        // 原文が無い / 正規形と同じなら「表記ゆれなし」＝ UI で併記しない。
        reservationNumberDiffers: !!raw && raw.trim() !== r.normalizedReservationNumber,
        codeNames: r.members.map((m) => m.codeName),
        source: r.source,
        confirmedAt: r.confirmedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        uzuSyncedAt: r.uzuSyncedAt?.toISOString() ?? null,
      };
    }),
  };
}
